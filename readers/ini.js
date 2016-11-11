'use strict';

var fs = require('fs');

exports.load = function (name, options, regex) {
    var result       = { main: {} };
    var current_sect = result.main;
    var current_sect_name = 'main';
    this.bool_matches = [];
    if (options && options.booleans) {
        this.bool_matches = options.booleans.slice();
    }

    // Initialize any booleans
    result = this.init_booleans(options, result);

    var match;
    var setter;
    var pre = '';

    fs.readFileSync(name, 'UTF-8')
    .split(/\r\n|\r|\n/)
    .forEach(function(line) {
        if (regex.comment.test(line)) { return; }
        if (regex.blank.test(line)  ) { return; }

        match = regex.section.exec(line);
        if (match) {
            if (!result[match[1]]) result[match[1]] = {};
            current_sect = result[match[1]];
            current_sect_name = match[1];
            return;
        }

        if (regex.continuation.test(line)) {
            pre += line.replace(regex.continuation, '');
            return;
        }

        line = pre + line;
        pre = '';

        match = regex.param.exec(line);
        if (!match) {
            exports.logger(
                    'Invalid line in config file \'' + name + '\': ' + line);
            return;
        }

        var is_array_match = regex.is_array.exec(match[1]);
        if (is_array_match) {
            setter = function(key, value) {
                key = key.replace('[]', '');
                if (! current_sect[key]) current_sect[key] = [];
                current_sect[key].push(value);
            };
        }
        else {
            setter = function (key, value) { current_sect[key] = value; };
        }

        if (options && Array.isArray(options.booleans) &&
            (
                exports.bool_matches.indexOf(current_sect_name + '.' + match[1]) !== -1
                ||
                exports.bool_matches.indexOf('*.' + match[1]) !== -1
            )) {
            current_sect[match[1]] = regex.is_truth.test(match[2]);
            // var msg = 'Using boolean ' + current_sect[match[1]] +
            // ' for ' + current_sect_name + '.' + match[1] + '=' + match[2];
            // exports.logger(msg, 'logdebug');
        }
        else if (regex.is_integer.test(match[2])) {
            setter(match[1], parseInt(match[2], 10));
        }
        else if (regex.is_float.test(match[2])) {
            setter(match[1], parseFloat(match[2]));
        }
        else {
            setter(match[1], match[2]);
        }
    });

    return result;
};

exports.empty = function (options) {
    this.bool_matches = [];
    return this.init_booleans(options, { main: {} });
};

exports.init_booleans = function (options, result) {
    if (!options) return result;
    if (!Array.isArray(options.booleans)) return result;

    // console.log(options.booleans);
    for (var i=0; i<options.booleans.length; i++) {
        var m = /^(?:([^\. ]+)\.)?(.+)/.exec(options.booleans[i]);
        if (!m) continue;

        var section = m[1] || 'main';
        var key     = m[2];

        var bool_default = section[0] === '+' ? true
                         :     key[0] === '+' ? true
                         : false;

        if (section.match(/^(\-|\+)/)) section = section.substr(1);
        if (    key.match(/^(\-|\+)/)) key     =     key.substr(1);

        if (section === '*') continue;  // wildcard, don't initialize

        // so boolean detection in the next section will match
        if (options.booleans.indexOf(section + '.' + key) === -1) {
            this.bool_matches.push(section + '.' + key);
        }

        if (!result[section]) result[section] = {};
        result[section][key] = bool_default;
    }

    return result;
};

exports.logger = function (msg, level) {
    // if (!level) level = 'logwarn';
    console.log(msg);
};
