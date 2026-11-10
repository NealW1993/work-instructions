/** Arithmetic-only evaluator. Saved formulas must never execute JavaScript. */
export const FORMULA_CONSTANTS: Record<string, number> = {
  e: Math.E, E: Math.E, pi: Math.PI, PI: Math.PI,
};

const HELPERS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan,
  atan2: Math.atan2, cbrt: Math.cbrt, ceil: Math.ceil, cos: Math.cos,
  exp: Math.exp, floor: Math.floor, log: Math.log, log10: Math.log10,
  max: Math.max, min: Math.min, pow: Math.pow, round: Math.round,
  sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan, trunc: Math.trunc,
};

export function isReservedFormulaName(name: string) {
  return Object.hasOwn(HELPERS, name) || Object.hasOwn(FORMULA_CONSTANTS, name) ||
    ["__proto__", "constructor", "prototype"].includes(name);
}

export function normalizeFormulaExpression(expression: string) {
  return expression.replace(/π|Π/g, "pi").replace(/×/g, "*")
    .replace(/÷/g, "/").replace(/−/g, "-").replace(/√\s*\(/g, "sqrt(")
    .replace(/\^/g, "**").trim();
}

export function evaluateFormulaExpression(
  expression: string,
  variables: Record<string, number>,
): { value: number | null; error: string | null } {
  const source = normalizeFormulaExpression(expression);
  if (!source) return { value: null, error: "Expression is required." };
  if (source.length > 4096) return { value: null, error: "Expression is too long." };

  try {
    const tokens: string[] = [];
    const tokenPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|([A-Za-z_]\w*)|(\*\*|[+\-*/%(),]))/y;
    let offset = 0;
    while (offset < source.length) {
      tokenPattern.lastIndex = offset;
      const match = tokenPattern.exec(source);
      if (!match) throw new Error("Use numbers, variables, arithmetic, and supported math helpers.");
      tokens.push(match[0].trim());
      offset = tokenPattern.lastIndex;
      if (tokens.length > 1024) throw new Error("Expression is too complex.");
    }
    let position = 0;
    let depth = 0;
    const peek = () => tokens[position];
    function finite(value: number) {
      if (!Number.isFinite(value)) throw new Error("Result is not a finite number. Check divisors and function inputs.");
      return value;
    }
    function primary(): number {
      depth += 1;
      if (depth > 64) throw new Error("Expression nesting is too deep.");
      try {
        const token = tokens[position++];
        if (!token) throw new Error("Expression is incomplete.");
        if (token === "(") {
          const value = sum();
          if (tokens[position++] !== ")") throw new Error("A closing parenthesis is required.");
          return value;
        }
        if (/^(?:\d|\.)/.test(token)) return finite(Number(token));
        if (!/^[A-Za-z_]\w*$/.test(token)) throw new Error(`Unexpected token: ${token}`);
        if (peek() === "(") {
          if (!Object.hasOwn(HELPERS, token)) throw new Error(`Unknown math helper: ${token}`);
          position += 1;
          const args: number[] = [];
          if (peek() !== ")") {
            args.push(sum());
            while (peek() === ",") { position += 1; args.push(sum()); }
          }
          if (tokens[position++] !== ")") throw new Error("A closing parenthesis is required.");
          const expected = ["min", "max"].includes(token) ? null : ["atan2", "pow"].includes(token) ? 2 : 1;
          if ((expected === null && args.length === 0) || (expected !== null && args.length !== expected)) {
            throw new Error(`Check the number of arguments for ${token}.`);
          }
          return finite(HELPERS[token](...args));
        }
        if (!Object.hasOwn(variables, token)) throw new Error(`Unknown variable: ${token}`);
        return finite(variables[token]);
      } finally { depth -= 1; }
    }
    function power(): number {
      const left = primary();
      if (peek() === "**") { position += 1; return finite(left ** unary()); }
      return left;
    }
    function unary(): number {
      if (peek() === "+" || peek() === "-") {
        const sign = tokens[position++];
        depth += 1;
        if (depth > 64) throw new Error("Expression nesting is too deep.");
        try { return sign === "-" ? -unary() : unary(); } finally { depth -= 1; }
      }
      return power();
    }
    function product(): number {
      let value = unary();
      while (["*", "/", "%"].includes(peek())) {
        const operator = tokens[position++];
        const right = unary();
        value = finite(operator === "*" ? value * right : operator === "/" ? value / right : value % right);
      }
      return value;
    }
    function sum(): number {
      let value = product();
      while (peek() === "+" || peek() === "-") {
        const operator = tokens[position++];
        const right = product();
        value = finite(operator === "+" ? value + right : value - right);
      }
      return value;
    }
    const value = sum();
    if (position !== tokens.length) throw new Error(`Unexpected token: ${peek()}`);
    return { value: finite(value), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "Expression could not be evaluated." };
  }
}
