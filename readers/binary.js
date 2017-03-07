'use strict';

var fs = require('fs');

exports.load = function (name) {
    return fs.readFileSync(name);
};

exports.loadPromise = function (name) {
    return new Promise(function (resolve, reject) {
        fs.readFile(name, function (err, content) {
            if (err) return reject(err);
            resolve({ path: name, data: content });
        });
    });
};

exports.empty = function () {
    return null;
};
