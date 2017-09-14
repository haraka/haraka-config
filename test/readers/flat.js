'use strict';

const regex = require('../../configfile').regex;

const _set_up = function (done) {
    this.flat = require('../../readers/flat');
    done();
};

exports.load = {
    setUp: _set_up,
    'module is required' : function (test) {
        test.expect(1);
        test.ok(this.flat);
        test.done();
    },
    'has a load function': function (test) {
        test.expect(1);
        test.ok(typeof this.flat.load === 'function');
        test.done();
    },
    'loads the test flat file, as list': function (test) {
        test.expect(1);
        const result = this.flat.load(
            'test/config/test.flat', 'list', null, regex);
        test.deepEqual(result, [ 'line1', 'line2', 'line3', 'line5' ]);
        test.done();
    },
    'loads the test flat file, unspecified type': function (test) {
        test.expect(1);
        const result = this.flat.load(
            'test/config/test.flat', null, null, regex);
        test.deepEqual(result, 'line1');
        test.done();
    },
    'returns hostname for empty "me"': function (test) {
        test.expect(1);
        const result = this.flat.load( 'test/config/me', null, null, regex);
        console.log(result);
        test.ok(result);
        test.done();
    },
};
