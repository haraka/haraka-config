'use strict';

const fs = require('fs');

exports.load = function (name, type, options, regex) {
    let result = [];

    let data = fs.readFileSync(name, 'UTF-8');
    if (type === 'data') {
        while (data.length > 0) {
            const match = data.match(/^([^\r\n]*)\r?\n?/);
            result.push(match[1]);
            data = data.slice(match[0].length);
        }
        return result;
    }

    data.split(/\r\n|\r|\n/).forEach( function (line) {
        if (regex.comment.test(line)) { return; }
        if (regex.blank.test(line))   { return; }

        const line_data = regex.line.exec(line);
        if (!line_data) return;

        result.push(line_data[1].trim());
    });

    if (result.length && type !== 'list' && type !== 'data') {
        result = result[0];
        if (options && in_array(result, options.booleans)) {
            return regex.is_truth.test(result);
        }
        if (regex.is_integer.test(result)) {
            return parseInt(result, 10);
        }
        if (regex.is_float.test(result)) {
            return parseFloat(result);
        }
        return result;
    }

    // Return hostname for 'me' if no result
    if (/\/me$/.test(name) && !(result && result.length)) {
        return [ require('os').hostname() ];
    }

    // For value types with no result
    if (!(type && (type === 'list' || type === 'data'))) {
        if (!(result && result.length)) {
            return null;
        }
    }

    return result;
}

exports.empty = function (options, type) {
    if (type) {
        if (type === 'flat') { return null; }
        if (type === 'value') { return null; }
    }
    return [];
}

function in_array (item, array) {
    if (!array) return false;
    if (!Array.isArray(array)) return false;
    return (array.indexOf(item) !== -1);
}
