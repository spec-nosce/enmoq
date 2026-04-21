/**
 * Query Engine
 *
 * Executes parsed queries against in-memory table data.
 */

const { formatForJSON } = require('./utils');

class QueryEngine {
  /**
   * Execute a parsed query
   */
  execute(parsedQuery, tables) {
    const { type } = parsedQuery;

    switch (type) {
      case 'SELECT':
        return this.executeSelect(parsedQuery, tables);
      default:
        throw new Error(`Unsupported query type: ${type}`);
    }
  }

  /**
   * Execute SELECT query
   */
  executeSelect(parsedQuery, tables) {
    const { table: tableName, columns, where, groupBy, orderBy, limit } = parsedQuery;

    // Get table data
    const table = tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

    // Start with all rows
    let rows = [...table.rows];

    // Apply WHERE filter
    if (where) {
      rows = this.filterRows(rows, where, table.schema);
    }

    // Apply GROUP BY and aggregations
    if (groupBy.length > 0) {
      rows = this.groupRows(rows, groupBy, columns, table.schema);
    } else {
      // Project columns (without aggregation)
      rows = this.projectColumns(rows, columns, table.schema);
    }

    // Apply ORDER BY
    if (orderBy.length > 0) {
      rows = this.sortRows(rows, orderBy);
    }

    // Apply LIMIT
    if (limit !== null) {
      rows = rows.slice(0, limit);
    }

    return rows;
  }

  /**
   * Filter rows by WHERE clause
   */
  filterRows(rows, where, schema) {
    return rows.filter((row) => this.evaluateCondition(row, where, schema));
  }

  /**
   * Evaluate a WHERE condition
   */
  evaluateCondition(row, condition, schema) {
    if (condition.type === 'AND') {
      return condition.conditions.every((c) => this.evaluateCondition(row, c, schema));
    }

    if (condition.type === 'OR') {
      return condition.conditions.some((c) => this.evaluateCondition(row, c, schema));
    }

    if (condition.type === 'comparison') {
      let leftValue;

      // Handle function calls
      if (condition.function) {
        const columnName = condition.args[0];
        leftValue = this.applyFunction(condition.function, row[columnName], row);
      } else {
        leftValue = row[condition.column];
      }

      const rightValue = condition.value;
      const { operator } = condition;

      return this.compareValues(leftValue, operator, rightValue);
    }

    throw new Error(`Unknown condition type: ${condition.type}`);
  }

  /**
   * Compare two values with an operator
   */
  compareValues(left, operator, right) {
    // Handle Date comparisons
    if (left instanceof Date) {
      right = new Date(right);
    }

    switch (operator) {
      case '=':
        return left === right;
      case '!=':
        return left !== right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  /**
   * Apply ClickHouse function
   */
  applyFunction(funcName, value, row) {
    switch (funcName.toLowerCase()) {
      case 'todate':
        return this.toDate(value);
      case 'todatetime':
        return this.toDateTime(value);
      case 'tomonday':
        return this.toMonday(value);
      case 'tostartofmonth':
        return this.toStartOfMonth(value);
      case 'addmonths':
        // For addMonths, we need to parse args differently
        // This will be handled in column projection
        return value;
      case 'toyyyymmdd':
        return this.toYYYYMMDD(value);
      default:
        return value;
    }
  }

  /**
   * Date/Time Functions
   */
  toDate(value) {
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    return value;
  }

  toDateTime(value) {
    if (typeof value === 'string') {
      return new Date(value);
    }
    return value;
  }

  toMonday(value) {
    if (value instanceof Date) {
      const date = new Date(value);
      const day = date.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day; // Days to subtract to get to Monday
      const monday = new Date(date);
      monday.setUTCDate(date.getUTCDate() + diff);
      return monday.toISOString().split('T')[0];
    }
    return value;
  }

  toStartOfMonth(value) {
    if (value instanceof Date) {
      const date = new Date(value);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      const firstDay = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      return firstDay.toISOString().split('T')[0];
    }
    return value;
  }

  toYYYYMMDD(value) {
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    }
    return value;
  }

  /**
   * Project columns (SELECT clause)
   */
  projectColumns(rows, columns, schema) {
    if (columns.length === 1 && columns[0] === '*') {
      return rows;
    }

    return rows.map((row) => {
      const projected = {};

      for (const col of columns) {
        if (col.function) {
          // Handle function calls
          const result = this.evaluateColumnFunction(col, row);
          const key = col.alias || col.expression;
          projected[key] = result;
        } else {
          // Simple column reference
          const key = col.alias || col.expression;
          projected[key] = row[col.expression];
        }
      }

      return projected;
    });
  }

  /**
   * Evaluate column function expression
   */
  evaluateColumnFunction(col, row) {
    const { function: funcName, args } = col;

    switch (funcName.toLowerCase()) {
      case 'todate':
        return this.toDate(row[args[0]]);
      case 'tomonday': {
        const date = row[args[0]];
        const monday = this.toMonday(date);
        // Handle INTERVAL addition (e.g., toMonday(date) + INTERVAL 6 DAY)
        if (col.expression.includes('+ INTERVAL')) {
          const intervalMatch = col.expression.match(/\+\s*INTERVAL\s+(\d+)\s+DAY/i);
          if (intervalMatch) {
            const days = parseInt(intervalMatch[1]);
            const result = new Date(monday);
            result.setDate(result.getDate() + days);
            return result.toISOString().split('T')[0];
          }
        }
        return monday;
      }
      case 'tostartofmonth': {
        const date = row[args[0]];
        const monthStart = this.toStartOfMonth(date);
        // Handle addMonths and INTERVAL subtraction
        if (col.expression.includes('addMonths')) {
          const addMonthsMatch = col.expression.match(/addMonths\([^,]+,\s*(\d+)\)/);
          if (addMonthsMatch) {
            const months = parseInt(addMonthsMatch[1]);
            const result = new Date(monthStart);
            result.setMonth(result.getMonth() + months);

            // Handle INTERVAL subtraction
            if (col.expression.includes('- INTERVAL')) {
              const intervalMatch = col.expression.match(/-\s*INTERVAL\s+(\d+)\s+DAY/i);
              if (intervalMatch) {
                const days = parseInt(intervalMatch[1]);
                result.setDate(result.getDate() - days);
              }
            }

            return result.toISOString().split('T')[0];
          }
        }
        return monthStart;
      }
      case 'argmax':
        // argMax is handled in grouping
        return null;
      default:
        return row[args[0]];
    }
  }

  /**
   * Group rows and apply aggregations
   */
  groupRows(rows, groupByColumns, selectColumns, schema) {
    // Group rows by groupBy columns
    const groups = new Map();

    for (const row of rows) {
      // Create group key
      const keyParts = groupByColumns.map((col) => {
        // Evaluate functions in GROUP BY
        if (col.includes('(')) {
          const funcMatch = col.match(/^(\w+)\((.+?)\)$/);
          if (funcMatch) {
            const funcName = funcMatch[1];
            const arg = funcMatch[2];
            return this.applyFunction(funcName, row[arg], row);
          }
        }
        return row[col];
      });
      const key = JSON.stringify(keyParts);

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(row);
    }

    // Apply aggregations to each group
    const results = [];
    for (const [key, groupRows] of groups.entries()) {
      const result = {};
      const keyParts = JSON.parse(key);

      // Add GROUP BY columns
      groupByColumns.forEach((col, index) => {
        // Extract column name from function if needed
        let columnName = col;
        if (col.includes('(')) {
          const funcMatch = col.match(/^(\w+)\((.+?)\)$/);
          if (funcMatch) {
            columnName = funcMatch[2]; // Use argument name
          }
        }
        result[col] = keyParts[index];
      });

      // Apply aggregations from SELECT clause
      for (const col of selectColumns) {
        if (col.function) {
          // Check if it's an aggregation function or a transformation function
          const isAggregation = this.isAggregationFunction(col.function);

          if (isAggregation) {
            const aggResult = this.aggregate(col.function, col.args, groupRows);
            const key = col.alias || col.expression;
            result[key] = aggResult;
          } else {
            // Transformation function - already computed in GROUP BY
            const key = col.alias || col.expression;
            // The value is already in the result from GROUP BY columns
            if (!result.hasOwnProperty(key)) {
              // If not from GROUP BY, evaluate on first row
              result[key] = this.evaluateColumnFunction(col, groupRows[0]);
            }
          }
        } else if (!groupByColumns.includes(col.expression)) {
          // Non-aggregated column not in GROUP BY - take first value
          result[col.expression] = groupRows[0][col.expression];
        }
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Check if function is an aggregation function
   */
  isAggregationFunction(funcName) {
    const aggregationFunctions = ['count', 'sum', 'avg', 'min', 'max', 'argmax'];
    return aggregationFunctions.includes(funcName.toLowerCase());
  }

  /**
   * Apply aggregation function
   */
  aggregate(funcName, args, rows) {
    switch (funcName.toLowerCase()) {
      case 'argmax': {
        // argMax(column, orderColumn) - return column value where orderColumn is maximum
        const valueCol = args[0].trim();
        const orderCol = args[1].trim();

        let maxRow = rows[0];
        let maxValue = rows[0][orderCol];

        for (const row of rows) {
          const currentValue = row[orderCol];
          if (
            currentValue > maxValue ||
            (currentValue instanceof Date && maxValue instanceof Date && currentValue > maxValue)
          ) {
            maxValue = currentValue;
            maxRow = row;
          }
        }

        return maxRow[valueCol];
      }
      case 'count':
        return rows.length;
      case 'sum': {
        const col = args[0].trim();
        return rows.reduce((sum, row) => sum + (Number(row[col]) || 0), 0);
      }
      case 'avg': {
        const col = args[0].trim();
        const sum = rows.reduce((sum, row) => sum + (Number(row[col]) || 0), 0);
        return sum / rows.length;
      }
      case 'min': {
        const col = args[0].trim();
        return Math.min(...rows.map((row) => Number(row[col]) || 0));
      }
      case 'max': {
        const col = args[0].trim();
        return Math.max(...rows.map((row) => Number(row[col]) || 0));
      }
      default:
        throw new Error(`Unknown aggregation function: ${funcName}`);
    }
  }

  /**
   * Sort rows by ORDER BY clause
   */
  sortRows(rows, orderBy) {
    return rows.sort((a, b) => {
      for (const { column, direction } of orderBy) {
        let aVal = a[column];
        let bVal = b[column];

        // Handle different types
        if (aVal instanceof Date && bVal instanceof Date) {
          aVal = aVal.getTime();
          bVal = bVal.getTime();
        }

        if (aVal < bVal) return direction === 'ASC' ? -1 : 1;
        if (aVal > bVal) return direction === 'ASC' ? 1 : -1;
      }
      return 0;
    });
  }
}

module.exports = QueryEngine;
