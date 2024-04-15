module.exports = {
  section: /^\s*\[\s*([^\]]*?)\s*\]\s*$/,
  param: /^\s*([\w@:._\-/[\]]+)\s*(?:=\s*(.*?)\s*)?$/,
  comment: /^\s*[;#].*$/,
  line: /^\s*(.*?)\s*$/,
  blank: /^\s*$/,
  continuation: /\\[ \t]*$/,
  is_integer: /^-?\d+$/,
  is_float: /^-?\d+\.\d+$/,
  is_truth: /^(?:true|yes|ok|enabled|on|1)$/i,
  is_array: /(.+)\[\]$/,
}
