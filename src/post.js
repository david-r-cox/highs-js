///////////////////////////////////////////////////////////////////////////////
// https://github.com/Ivordir/YALPS/blob/main/benchmarks/mps.ts
// (converted to js)

const OptimizationDirection = Object.freeze({
 maximize: "maximize",
 minimize: "minimize"
});

// Reads and parses a MPS file
// OBJSENSE, OBJNAME, and SOS sections are not supported
// Comments must have an asterisk (*) at the start of the line
// Comments can also be placed after column 61
// Each column/variable is assumed to have only one entry in the BOUNDS section
// except for a pair of (LO and UP) or (LI and UI).

const ConstraintType = Object.freeze({
 L: "L",
 G: "G",
 E: "E",
 N: "N"
});

const modelFromMps = (mps, direction) => {
 let mps_str = mps.toString('utf-8');
 const parseState = {
   lines: mps_str.split(/\r?\n/),
   index: 0,
   constraintTypes: new Map(),
 };

 const model = {
   name: "",
   direction,
   constraints: new Map(),
   variables: new Map(),
   integers: new Set(),
   binaries: new Set(),
   bounds: new Map(),
 };

 const error = readName(parseState, model);
 if (error != null) throw new Error(`Line ${parseState.index + 1}: ${error.message}`);

 return model;
};

const field1 = (line) => line.substring(1, 3).trim();
const field2 = (line) => line.substring(4, 12).trim();
const field3 = (line) => line.substring(14, 22).trim();
const field4 = (line) => line.substring(24, 36).trim();
const field5 = (line) => line.substring(39, 47).trim();
const field6 = (line) => line.substring(49, 61).trim();

const readName = (s, m) => {
 const i = s.lines.findIndex(line => line.startsWith("NAME"));
 if (i < 0) return new Error("No NAME section was found");
 m.name = field3(s.lines[i]);
 s.index = i + 1;
 return readRows(s, m);
};

const notSectionEnd = (line) => line?.startsWith(" ") ?? false;

const nextLine = (s) => {
 for (let i = s.index + 1; i < s.lines.length; i++) {
   if (!s.lines[i].startsWith("*")) {
     s.index = i;
     return s.lines[i];
   }
 }
 return undefined;
};

const readSection = (s) => s.lines[s.index]?.trimEnd();

const sectionErr = (expected, section) =>
 new Error(`Expected section ${expected} but got ${section === undefined ? "end of file" : `'${section}'`}`);

const expectSection = (s, section) => {
 const name = readSection(s);
 return name === section ? null : sectionErr(section, name);
};

const readRows = (s, m) => {
 const sectionErr = expectSection(s, "ROWS");
 if (sectionErr != null) return sectionErr;

 for (let line = nextLine(s); notSectionEnd(line); line = nextLine(s)) {
   // warn/error on extra fields5 or field6?

   const name = field2(line);
   if (name === "") return new Error(`Missing row name`);
   if (s.constraintTypes.has(name)) return new Error(`The row '${name}' was already defined`);

   const type = field1(line);
   // prettier-ignore
   switch (type) {
     case "L": m.constraints.set(name, [-Infinity, 0.0]); break;
     case "G": m.constraints.set(name, [0.0, Infinity]); break;
     case "E": m.constraints.set(name, [0.0, 0.0]); break;
     case "N":
       m.objective ??= name;
       m.constraints.set(name, [-Infinity, Infinity]);
       break;
     case "": return new Error(`Missing row type`);
     default: return new Error(`Unexpected row type '${type}'`);
   }
   s.constraintTypes.set(name, type);
 }

 return readColumns(s, m);
};

const addCoefficient = (s, variable, row, value) => {
 if (row === "") return new Error("Missing row name");
 if (value === "") return new Error("Missing coefficient value");
 if (!s.constraintTypes.has(row)) return new Error(`The row '${row}' was not defined in the ROWS section`);
 if (variable.has(row)) return new Error(`The coefficient for row '${row}' was previously set for this column`);

 const val = parseFloat(value);
 if (Number.isNaN(val)) return new Error(`Failed to parse number '${value}'`);

 variable.set(row, val);

 return null;
};

const readColumns = (s, m) => {
 const sectionErr = expectSection(s, "COLUMNS");
 if (sectionErr != null) return sectionErr;

 let integerMarked = false;
 let line = nextLine(s);
 while (notSectionEnd(line)) {
   if (field3(line) === "'MARKER'") {
     const marker = field4(line);
     // prettier-ignore
     switch (marker) {
       case "'INTORG'": integerMarked = true; break;
       case "'INTEND'": integerMarked = false; break;
       default: return new Error(`Unexpected MARKER '${marker}'`);
     }
     line = nextLine(s);
     continue;
   }

   const name = field2(line);
   if (name === "") return new Error("Missing column name");
   if (m.variables.has(name))
     return new Error(
       `Values for the column '${name}' were previously provided -- all values for a column must come consecutively`,
     );

   const variable = new Map();
   do {
     // warn/error on extra field1?

     const err1 = addCoefficient(s, variable, field3(line), field4(line));
     if (err1 != null) return err1;

     const name2 = field5(line);
     const value2 = field6(line);
     if (name2 !== "" || value2 !== "") {
       const err2 = addCoefficient(s, variable, name2, value2);
       if (err2 != null) return err2;
     }

     line = nextLine(s);
   } while (notSectionEnd(line) && field2(line) === name);

   m.variables.set(name, variable);
   if (integerMarked) m.integers.add(name);
 }

 return readRHS(s, m);
};

const addConstraint = (s, m, row, value) => {
 if (row === "") return new Error("Missing row name");
 if (value === "") return new Error("Missing rhs value");

 const type = s.constraintTypes.get(row);
 if (type === undefined) return new Error(`The row '${row}' was not defined in the ROWS section`);

 const val = parseFloat(value);
 if (Number.isNaN(val)) return new Error(`Failed to parse number '${value}'`);

 // ignore duplicates?
 const constraint = m.constraints.get(row);
 if (type === "L" || type === "E") constraint[1] = val;
 if (type === "G" || type === "E") constraint[0] = val;

 return null;
};

const readRHS = (s, m) => {
 const error = expectSection(s, "RHS");
 if (error != null) return error;

 for (let line = nextLine(s); notSectionEnd(line); line = nextLine(s)) {
   // warn/error on extra field1?
   // const name = field2(line) // ignore rhs name?

   const err1 = addConstraint(s, m, field3(line), field4(line));
   if (err1 != null) return err1;

   const name2 = field5(line);
   const value2 = field6(line);
   if (name2 !== "" || value2 !== "") {
     const err2 = addConstraint(s, m, name2, value2);
     if (err2 != null) return err2;
   }
 }

 const section = readSection(s);
 // prettier-ignore
 switch (section) {
   case "RANGES": return readRanges(s, m);
   case "BOUNDS": return readBounds(s, m);
   case "ENDATA": return null;
   default: return sectionErr("RANGES, BOUNDS, or ENDATA", section);
 }
};

const addRange = (s, m, row, value) => {
 if (row === "") return new Error("Missing row name");
 if (value === "") return new Error("Missing range value");

 const type = s.constraintTypes.get(row);
 if (type === undefined) return new Error(`The row '${row}' was not defined in the ROWS section`);

 const val = parseFloat(value);
 if (Number.isNaN(val)) return new Error(`Failed to parse number '${value}'`);

 const bounds = m.constraints.get(row);
 // ignore duplicates?
 if (type === "L" || (type === "E" && val < 0.0)) bounds[0] = bounds[1] - Math.abs(val);
 if (type === "G" || (type === "E" && val > 0.0)) bounds[1] = bounds[0] + Math.abs(val);

 return null;
};

const readRanges = (s, m) => {
 for (let line = nextLine(s); notSectionEnd(line); line = nextLine(s)) {
   // warn/error on extra field1?
   // const name = field2(line) // ignore range name?

   const err1 = addRange(s, m, field3(line), field4(line));
   if (err1 != null) return err1;

   const name2 = field5(line);
   const value2 = field6(line);
   if (name2 !== "" || value2 !== "") {
     const err2 = addRange(s, m, name2, value2);
     if (err2 != null) return err2;
   }
 }

 const section = readSection(s);
 // prettier-ignore
 switch (section) {
   case "BOUNDS": return readBounds(s, m);
   case "ENDATA": return null;
   default: return sectionErr("BOUNDS or ENDATA", section);
 }
};

const setBounds = ({ bounds }, name, lower, upper) => {
 const bnds = (bounds.has(name) ? bounds : bounds.set(name, [0.0, Infinity])).get(name);
 if (!Number.isNaN(lower)) bnds[0] = lower;
 if (!Number.isNaN(upper)) bnds[1] = upper;
};

const readBounds = (s, m) => {
 for (let line = nextLine(s); notSectionEnd(line); line = nextLine(s)) {
   // warn on extra field5 or field6?
   // const name = field2(line) // ignore bounds name?
   const type = field1(line);

   const col = field3(line);
   if (col === "") return new Error("Missing column name");
   if (!m.variables.has(col)) return new Error(`The column '${col}' was not defined in the COLUMNS section`);

   let val = NaN;
   if (["LO", "UP", "FX", "LI", "UI"].includes(type)) {
     const value = field4(line);
     if (value === "") return new Error("Missing bound value");
     val = parseFloat(value);
     if (Number.isNaN(val)) return new Error(`Failed to parse number '${value}'`);
   }

   // prettier-ignore
   switch (type) {
     case "LO": setBounds(m, col, val, Infinity); break;
     case "UP": setBounds(m, col, 0.0, val); break;
     case "FX": setBounds(m, col, val, val); break;
     case "FR": setBounds(m, col, -Infinity, Infinity); break;
     case "MI": setBounds(m, col, -Infinity, 0.0); break;
     case "PL": setBounds(m, col, 0.0, Infinity); break;
     case "BV": m.binaries.add(col); break;
     case "LI":
       m.integers.add(col);
       setBounds(m, col, val, Infinity);
       break;
     case "UI":
       m.integers.add(col);
       setBounds(m, col, 0.0, val);
       break;
     case "SC": return new Error("SC bound type is unsupported");
     case "": return new Error("Missing bound type");
     default: return new Error(`Unexpected bound type '${type}'`);
   }
 }

 return expectSection(s, "ENDATA");
};

///////////////////////////////////////////////////////////////////////////////

Module.Highs_readModel = Module["cwrap"]("Highs_readModel", "number", [
  "number",
  "string",
]);
const Highs_setIntOptionValue = Module["cwrap"](
  "Highs_setIntOptionValue",
  "number",
  ["number", "string", "number"]
);
const Highs_setDoubleOptionValue = Module["cwrap"](
  "Highs_setDoubleOptionValue",
  "number",
  ["number", "string", "number"]
);
const Highs_setStringOptionValue = Module["cwrap"](
  "Highs_setStringOptionValue",
  "number",
  ["number", "string", "string"]
);
const Highs_setBoolOptionValue = Module["cwrap"](
  "Highs_setBoolOptionValue",
  "number",
  ["number", "string", "number"]
);
Module.Highs_writeSolutionPretty = Module["cwrap"](
  "Highs_writeSolutionPretty",
  "number",
  ["number", "string"]
);


const MODEL_STATUS_CODES = /** @type {const} */ ({
  0: "Not Set",
  1: "Load error",
  2: "Model error",
  3: "Presolve error",
  4: "Solve error",
  5: "Postsolve error",
  6: "Empty",
  7: "Optimal",
  8: "Infeasible",
  9: "Primal infeasible or unbounded",
  10: "Unbounded",
  11: "Bound on objective reached",
  12: "Target for objective reached",
  13: "Time limit reached",
  14: "Iteration limit reached",
  15: "Unknown",
});

/** @typedef {Object} Highs */

var
/** @type {()=>Highs} */ _Highs_create,
/** @type {(Highs)=>void} */ _Highs_run,
/** @type {(Highs)=>void} */ _Highs_destroy,
/** @type {(Highs, number)=>(keyof (typeof MODEL_STATUS_CODES))} */ _Highs_getModelStatus,
/** @type {any}*/ FS;

/**
 * Solve a model in the CPLEX LP or MPS file format.
 * @param {string} model_str The problem to solve in the .lp or .mps format
 * @param {undefined | import("../types").HighsOptions} highs_options Options to pass the solver. See https://github.com/ERGO-Code/HiGHS/blob/c70854d/src/lp_data/HighsOptions.h
 * @param {('lp' | 'mps')} [file_format='lp'] The file format of the input model
 * @returns {import("../types").HighsSolution} The solution
 */
Module["solve"] = function (model_str, highs_options, file_format = "lp") {
  const MODEL_FILENAME = file_format == "mps" ? "m.mps" : "m.lp";

  FS.writeFile(MODEL_FILENAME, model_str);
  const highs = _Highs_create();
  assert_ok(
    () => Module.Highs_readModel(highs, MODEL_FILENAME),
    "read LP model (see http://web.mit.edu/lpsolve/doc/CPLEX-format.htm)"
  );
  const options = highs_options || {};
  for (const option_name in options) {
    const option_value = options[option_name];
    const type = typeof option_value;
    let setoption;
    if (type === "number") setoption = setNumericOption;
    else if (type === "boolean") setoption = Highs_setBoolOptionValue;
    else if (type === "string") setoption = Highs_setStringOptionValue;
    else throw new Error(`Unsupported option value type ${option_value} for '${option_name}'`);
    assert_ok(
      () => setoption(highs, option_name, option_value),
      `set option '${option_name}'`
    );
  }
  assert_ok(() => _Highs_run(highs), "solve the problem");
  const status = MODEL_STATUS_CODES[_Highs_getModelStatus(highs, 0)] || "Unknown";
  // Flush the content of stdout in order to have a clean stream before writing the solution in it
  stdout_lines.length = 0;
  assert_ok(
    () => Module.Highs_writeSolutionPretty(highs, ""),
    "write and extract solution"
  );
  _Highs_destroy(highs);
  const output = parseResult(stdout_lines, status);
  // Flush the content of stdout and stderr because these streams are not used anymore
  stdout_lines.length = 0;
  stderr_lines.length = 0;
  return output;
};

function setNumericOption(highs, option_name, option_value) {
  let result = Highs_setDoubleOptionValue(highs, option_name, option_value);
  if (result === -1 && option_value === (option_value | 0))
    result = Highs_setIntOptionValue(highs, option_name, option_value);
  return result;
}

function parseNum(s) {
  if (s === "inf") return 1 / 0;
  else if (s === "-inf") return -1 / 0;
  else return +s;
}

const known_columns = {
  "Index": (s) => parseInt(s),
  "Lower": parseNum,
  "Upper": parseNum,
  "Primal": parseNum,
  "Dual": parseNum,
};

/**
 * @param {string} s
 * @returns {string[]} The values (words) of a line
 */
function lineValues(s) {
  return s.match(/[^\s]+/g) || [];
}

/**
 *
 * @param {string[]} headers
 * @param {string} line
 * @returns {Record<string, string | number>}
 */
function lineToObj(headers, line) {
  const values = lineValues(line);
  /** @type {Record<string, string | number>} */
  const result = {};
  for (let idx = 0; idx < values.length; idx++) {
    if (idx >= headers.length)
      throw new Error("Unable to parse solution line: " + line);
    const value = values[idx];
    const header = headers[idx];
    const parser = known_columns[header];
    const parsed = parser ? parser(value) : value;
    result[header] = parsed;
  }
  return result;
}

/**
 * Parse HiGHS output lines
 * @param {string[]} lines stdout from highs
 * @param {import("../types").HighsModelStatus} status status
 * @returns {import("../types").HighsSolution} The solution
 */
function parseResult(lines, status) {
  if (lines.length < 3)
    throw new Error("Unable to parse solution. Too few lines.");

  let headers = headersForNonEmptyColumns(lines[1], lines[2]);

  var result = {
    "Status": /** @type {"Infeasible"} */(status),
    "Columns": {},
    "Rows": [],
    "ObjectiveValue": NaN
  };

  // Parse columns
  for (var i = 2; lines[i] != "Rows"; i++) {
    const obj = lineToObj(headers, lines[i]);
    result["Columns"][obj["Name"]] = obj;
  }

  // Parse rows
  headers = headersForNonEmptyColumns(lines[i + 1], lines[i + 2]);
  for (var j = i + 2; lines[j] != ""; j++) {
    result["Rows"].push(lineToObj(headers, lines[j]));
  }

  // Parse objective value
  result["ObjectiveValue"] = parseNum(lines[j + 3].match(/Objective value: (.+)/)[1]);
  return result;
}

/**
 * Finds the non headers for non-empty columns in a HiGHS output
 * @param {string} headerLine The line containing the header names
 * @param {string} firstDataLine The line immediately below the header line
 * @returns {string[]} The headers for which there is data available
 */
function headersForNonEmptyColumns(headerLine, firstDataLine) {
  // Headers can correspond to empty columns. The contents of a column can be left or right
  // aligned, so we determine if a given header should be included by looking at whether
  // the row immediately below the header has any contents.
  return [...headerLine.matchAll(/[^\s]+/g)].filter(match =>
    firstDataLine[match.index] !== ' ' ||
    firstDataLine[match.index + match[0].length - 1] !== ' '
  ).map(match => match[0])
}

function assert_ok(fn, action) {
  let err;
  try {
    err = fn();
  } catch (e) {
    err = e;
  }
  // Allow HighsStatus::kOk (0) and HighsStatus::kWarning (1) but
  // disallow other values, such as e.g. HighsStatus::kError (-1).
  if (err !== 0 && err !== 1)
    throw new Error("Unable to " + action + ". HiGHS error " + err);
}
