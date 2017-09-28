'use strict';

const fs = require('fs');
const Hjson = require('hjson');

exports.load = function (name) {
    return Hjson.parse(fs.readFileSync(name, "utf8"));
};

exports.empty = function () {
    return {};
};
