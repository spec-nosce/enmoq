/**
 * Query Parser
 *
 * Parses ClickHouse SQL queries into executable structures.
 */

class QueryParser {
  /**
   * Parse a SELECT query
   */
  parseSelect(query) {
    // Remove extra whitespace and normalize
    query = query.trim().replace(/\s+/g, ' ');

    const parsed = {
      type: 'SELECT',
      columns: [],
      table: null,
      where: null,
      groupBy: [],
      orderBy: [],
      limit: null,
    };

    // Extract SELECT columns
    const selectMatch = query.match(/SELECT\s+(.+?)\s+FROM/i);
    if (!selectMatch) {
      throw new Error('Invalid SELECT query: missing FROM clause');
    }

    const columnsStr = selectMatch[1].trim();
    if (columnsStr === '*') {
      parsed.columns = ['*'];
    } else {
      // Parse columns (handle functions, aliases, etc.)
      parsed.columns = this.parseColumns(columnsStr);
    }

    // Extract FROM table
    const fromMatch = query.match(/FROM\s+(\w+)/i);
    if (!fromMatch) {
      throw new Error('Invalid SELECT query: missing table name');
    }
    parsed.table = fromMatch[1];

    // Extract WHERE clause (optional)
    const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
    if (whereMatch) {
      parsed.where = this.parseWhere(whereMatch[1].trim());
    }

    // Extract GROUP BY clause (optional)
    const groupByMatch = query.match(/GROUP\s+BY\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
    if (groupByMatch) {
      parsed.groupBy = groupByMatch[1].split(',').map((col) => col.trim());
    }

    // Extract ORDER BY clause (optional)
    const orderByMatch = query.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s*$)/i);
    if (orderByMatch) {
      parsed.orderBy = this.parseOrderBy(orderByMatch[1].trim());
    }

    // Extract LIMIT clause (optional)
    const limitMatch = query.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      parsed.limit = parseInt(limitMatch[1]);
    }

    return parsed;
  }

  /**
   * Parse SELECT columns
   */
  parseColumns(columnsStr) {
    const columns = [];
    let current = '';
    let parenDepth = 0;

    for (let i = 0; i < columnsStr.length; i++) {
      const char = columnsStr[i];

      if (char === '(') {
        parenDepth++;
        current += char;
      } else if (char === ')') {
        parenDepth--;
        current += char;
      } else if (char === ',' && parenDepth === 0) {
        columns.push(this.parseColumnExpression(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      columns.push(this.parseColumnExpression(current.trim()));
    }

    return columns;
  }

  /**
   * Parse a single column expression
   */
  parseColumnExpression(expr) {
    // Check for alias (AS keyword or implicit)
    const asMatch = expr.match(/^(.+?)\s+(?:AS\s+)?(\w+)$/i);
    if (asMatch && !expr.includes('(')) {
      return {
        expression: asMatch[1].trim(),
        alias: asMatch[2],
      };
    }

    // Check for function calls
    const funcMatch = expr.match(/^(\w+)\((.+?)\)(?:\s+(?:AS\s+)?(\w+))?$/i);
    if (funcMatch) {
      return {
        function: funcMatch[1],
        args: funcMatch[2].split(',').map((arg) => arg.trim()),
        alias: funcMatch[3] || null,
        expression: expr,
      };
    }

    // Simple column reference
    return {
      expression: expr,
      alias: null,
    };
  }

  /**
   * Parse WHERE clause
   */
  parseWhere(whereStr) {
    // Handle AND/OR logic
    if (whereStr.includes(' AND ') || whereStr.includes(' OR ')) {
      return this.parseLogicalExpression(whereStr);
    }

    // Single condition
    return this.parseCondition(whereStr);
  }

  /**
   * Parse logical expression (AND/OR)
   */
  parseLogicalExpression(expr) {
    // Simple implementation: split by OR first, then AND
    if (expr.includes(' OR ')) {
      const parts = this.splitByOperator(expr, ' OR ');
      return {
        type: 'OR',
        conditions: parts.map((part) => this.parseWhere(part.trim())),
      };
    }

    if (expr.includes(' AND ')) {
      const parts = this.splitByOperator(expr, ' AND ');
      return {
        type: 'AND',
        conditions: parts.map((part) => this.parseWhere(part.trim())),
      };
    }

    return this.parseCondition(expr);
  }

  /**
   * Split expression by operator (respecting parentheses)
   */
  splitByOperator(expr, operator) {
    const parts = [];
    let current = '';
    let parenDepth = 0;

    for (let i = 0; i < expr.length; i++) {
      const char = expr[i];

      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;

      if (parenDepth === 0 && expr.substring(i, i + operator.length) === operator) {
        parts.push(current.trim());
        current = '';
        i += operator.length - 1;
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  /**
   * Parse a single condition
   */
  parseCondition(conditionStr) {
    // Handle function calls (e.g., toDate(field) >= value)
    const funcMatch = conditionStr.match(/^(\w+)\(([^)]+)\)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
    if (funcMatch) {
      return {
        type: 'comparison',
        function: funcMatch[1],
        args: [funcMatch[2].trim()],
        operator: funcMatch[3],
        value: this.parseValue(funcMatch[4].trim()),
      };
    }

    // Handle parameter placeholders (e.g., {param: Type})
    const paramMatch = conditionStr.match(/^(\w+)\s*(>=|<=|>|<|=|!=)\s*\{(\w+):\s*(\w+)\}$/);
    if (paramMatch) {
      return {
        type: 'comparison',
        column: paramMatch[1],
        operator: paramMatch[2],
        parameter: paramMatch[3],
        parameterType: paramMatch[4],
      };
    }

    // Standard comparison
    const compMatch = conditionStr.match(/^(\w+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
    if (compMatch) {
      return {
        type: 'comparison',
        column: compMatch[1],
        operator: compMatch[2],
        value: this.parseValue(compMatch[3].trim()),
      };
    }

    throw new Error(`Could not parse condition: ${conditionStr}`);
  }

  /**
   * Parse a value (string, number, etc.)
   */
  parseValue(valueStr) {
    // Remove quotes from strings
    if (
      (valueStr.startsWith("'") && valueStr.endsWith("'")) ||
      (valueStr.startsWith('"') && valueStr.endsWith('"'))
    ) {
      return valueStr.slice(1, -1);
    }

    // Try to parse as number
    const num = Number(valueStr);
    if (!isNaN(num)) {
      return num;
    }

    // Return as-is
    return valueStr;
  }

  /**
   * Parse ORDER BY clause
   */
  parseOrderBy(orderByStr) {
    return orderByStr.split(',').map((part) => {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\w+)(?:\s+(ASC|DESC))?$/i);
      if (!match) {
        throw new Error(`Invalid ORDER BY: ${trimmed}`);
      }
      return {
        column: match[1],
        direction: (match[2] || 'ASC').toUpperCase(),
      };
    });
  }

  /**
   * Substitute query parameters
   */
  substituteParameters(query, params) {
    let result = query;

    for (const [key, value] of Object.entries(params)) {
      // Match {paramName: Type} pattern
      const regex = new RegExp(`\\{${key}:\\s*\\w+\\}`, 'g');

      // Format value based on type
      let formattedValue;
      if (typeof value === 'string') {
        formattedValue = `'${value}'`;
      } else {
        formattedValue = String(value);
      }

      result = result.replace(regex, formattedValue);
    }

    return result;
  }
}

module.exports = QueryParser;
