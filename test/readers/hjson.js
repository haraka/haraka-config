'use strict';

const _set_up = function (done) {
    this.hjson = require('../../readers/hjson');
    done();
};

exports.load = {
    setUp : _set_up,
    'module is required' : function (test) {
        test.expect(1);
        test.ok(this.hjson);
        test.done();
    },
    'has a load function': function (test) {
        test.expect(1);
        test.ok(typeof this.hjson.load === 'function');
        test.done();
    },
    'loads the test HJSON file': function (test) {
        test.expect(4);
        const result = this.hjson.load('test/config/test.hjson');
        // console.log(result);
        test.equal(result.matt, 'waz here and also made comments');
        test.ok(result.differentArray.length);
        test.ok(result.object['has a property one']);
        test.ok(result.object['has a property two']);
        test.done();
    },
};
