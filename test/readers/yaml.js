'use strict';

const _set_up = function (done) {
    this.yaml = require('../../readers/yaml');
    done();
};

exports.load = {
    setUp : _set_up,
    'module is required' : function (test) {
        test.expect(1);
        test.ok(this.yaml);
        test.done();
    },
    'has a load function': function (test) {
        test.expect(1);
        test.ok(typeof this.yaml.load === 'function');
        test.done();
    },
    'loads the test yaml file': function (test) {
        test.expect(4);
        const result = this.yaml.load('test/config/test.yaml');
        test.strictEqual(result.main.bool_true, true);
        test.equal(result.matt, 'waz here');
        test.ok(result.array.length);
        test.ok(result.objecty['has a property']);
        test.done();
    },
};
