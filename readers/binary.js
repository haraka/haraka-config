'use strict';

var fs = require('fs');

exports.load = function (name) {
    return fs.readFileSync(name);
};

exports.loadP = function (name) {
    return new Promise(function (resolve, reject) {
        fs.readFile(name, function (err, content) {
            if (err) return reject(err);
            resolve(content);
        });
    });
};

exports.empty = function () {
    return null;
};
