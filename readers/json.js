'use strict';

const fs = require('fs');

exports.load = (name) => {
    return JSON.parse(fs.readFileSync(name));
}

exports.empty = () => {
    return {};
}