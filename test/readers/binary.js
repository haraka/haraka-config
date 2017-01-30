'use strict';

var fs = require('fs');

var _set_up = function (done) {
    this.bin = require('../../readers/binary');
    done();
};

exports.load = {
    setUp : _set_up,
    'module is required' : function (test) {
        test.expect(1);
        test.ok(this.bin);
        test.done();
    },
    'has a load function': function (test) {
        test.expect(1);
        test.ok(typeof this.bin.load === 'function');
        test.done();
    },
    'loads the test binary file': function (test) {
        test.expect(3);
        var testBin = 'test/config/test.binary';
        var result = this.bin.load(testBin);
        test.ok(Buffer.isBuffer(result));
        test.equal(result.length, 120);
        test.deepEqual(result, fs.readFileSync(testBin));
        test.done();
    },
};
