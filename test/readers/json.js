'use strict';

const _set_up = function (done) {
    this.json = require('../../readers/json');
    done();
};

exports.load = {
    setUp : _set_up,
    'module is required' : function (test) {
        test.expect(1);
        test.ok(this.json);
        test.done();
    },
    'has a load function': function (test) {
        test.expect(1);
        test.ok(typeof this.json.load === 'function');
        test.done();
    },
    'loads the test JSON file': function (test) {
        test.expect(3);
        const result = this.json.load('test/config/test.json');
        // console.log(result);
        test.equal(result.matt, 'waz here');
        test.ok(result.array.length);
        test.ok(result.objecty['has a property']);
        test.done();
    },
};
