'use strict';

const path       = require('path');

const cfreader   = require('./configfile');

class Config {
    constructor (root_path, no_overrides) {
        this.root_path = root_path || cfreader.config_path;

        if (process.env.HARAKA_TEST_DIR) {
            this.root_path = path.join(process.env.HARAKA_TEST_DIR, 'config');
            return;
        }
        if (process.env.HARAKA && !no_overrides) {
            this.overrides_path = root_path || cfreader.config_path;
            this.root_path = path.join(process.env.HARAKA, 'config');
        }
    }

    get (name, type, cb, options) {
        const a = this.arrange_args([name, type, cb, options]);
        if (!a[1]) a[1] = 'value';

        const full_path = path.isAbsolute(name) ? name : path.resolve(this.root_path, a[0]);

        let results = cfreader.read_config(full_path, a[1], a[2], a[3]);

        if (this.overrides_path) {
            const overrides_path = path.resolve(this.overrides_path, a[0]);

            const overrides = cfreader.read_config(overrides_path, a[1], a[2], a[3]);

            results = merge_config(results, overrides, a[1]);
        }

        // Pass arrays by value to prevent config being modified accidentally.
        if (Array.isArray(results)) return results.slice();

        return results;
    }

    getInt (filename, default_value) {

        if (!filename) return NaN;

        const full_path = path.resolve(this.root_path, filename);
        const r = parseInt(cfreader.read_config(full_path, 'value', null, null), 10);

        if (!isNaN(r)) return r;
        return parseInt(default_value, 10);
    }

    getDir (name, opts, done) {
        cfreader.read_dir(path.resolve(this.root_path, name), opts).then((files) => {
            done(null, files)   // keep the API consistent
        }).catch(done)
    }

    arrange_args (args) {

        /* ways get() can be called:
            config.get('thing');
            config.get('thing', type);
            config.get('thing', cb);
            config.get('thing', cb, options);
            config.get('thing', options);
            config.get('thing', type, cb);
            config.get('thing', type, options);
            config.get('thing', type, cb, options);
        */
        const fs_name = args.shift();
        let fs_type = null;
        let cb;
        let options;

        for (let i=0; i < args.length; i++) {
            if (args[i] === undefined) continue;
            switch (typeof args[i]) {   // what is it?
                case 'function':
                    cb = args[i];
                    break;
                case 'object':
                    options = args[i];
                    break;
                case 'string':
                    if (/^(ini|value|list|data|h?json|js|yaml|binary)$/.test(args[i])) {
                        fs_type = args[i];
                        break;
                    }
                    console.log(`unknown string: ${args[i]}`);
                    break;
            }
            // console.log(`unknown arg: ${args[i]}, typeof: ${typeof args[i]}`);
        }

        if (!fs_type) {
            const fs_ext = path.extname(fs_name).substring(1);

            switch (fs_ext) {
                case 'hjson':
                case 'json':
                case 'yaml':
                case 'js':
                case 'ini':
                    fs_type = fs_ext;
                    break;

                default:
                    fs_type = 'value';
                    break;
            }
        }

        return [fs_name, fs_type, cb, options];
    }

    module_config (defaults_path, overrides_path) {
        const cfg = new Config(path.join(defaults_path, 'config'), true);
        if (overrides_path) {
            cfg.overrides_path = path.join(overrides_path, 'config');
        }
        return cfg;
    }
}

module.exports = new Config();

function merge_config (defaults, overrides, type) {
    switch (type) {
        case 'ini':
        case 'hjson':
        case 'json':
        case 'js':
        case 'yaml':
            return merge_struct(JSON.parse(JSON.stringify(defaults)), overrides);
    }

    if (Array.isArray(overrides) && Array.isArray(defaults) &&
        overrides.length > 0) {
        return overrides;
    }

    if (overrides != null) return overrides;

    return defaults;
}

function merge_struct (defaults, overrides) {
    for (const k in overrides) {
        if (k in defaults) {
            if (typeof overrides[k] === 'object' && typeof defaults[k] === 'object') {
                defaults[k] = merge_struct(defaults[k], overrides[k]);
            }
            else {
                defaults[k] = overrides[k];
            }
        }
        else {
            defaults[k] = overrides[k];
        }
    }
    return defaults;
}
