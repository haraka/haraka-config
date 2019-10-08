'use strict';

exports.load = function (name) {
    return require(name);
}

exports.empty = function () {
    return {};
}
