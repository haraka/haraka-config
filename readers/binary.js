'use strict';

const fs = require('fs');

exports.load = (name) => {
    return fs.readFileSync(name);
}

exports.loadPromise = (name) => {
    return new Promise((resolve, reject) => {
        fs.readFile(name, (err, content) => {
            if (err) return reject(err);
            resolve({ path: name, data: content });
        });
    });
}

exports.empty = () => {
    return null;
}
