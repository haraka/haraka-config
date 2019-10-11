'use strict';

const fs   = require('fs');
const yaml = require('js-yaml');

exports.load = (name) => {
    return yaml.safeLoad(fs.readFileSync(name, 'utf8'));
}

exports.empty = () => {
    return {};
}
