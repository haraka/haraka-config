'use strict';

// Config file loader
const fs   = require('fs');
const path = require('path');

// for "ini" type files
const regex = exports.regex = {
    section:        /^\s*\[\s*([^\]]*?)\s*\]\s*$/,
    param:          /^\s*([\w@:._\-/[\]]+)\s*(?:=\s*(.*?)\s*)?$/,
    comment:        /^\s*[;#].*$/,
    line:           /^\s*(.*?)\s*$/,
    blank:          /^\s*$/,
    continuation:   /\\[ \t]*$/,
    is_integer:     /^-?\d+$/,
    is_float:       /^-?\d+\.\d+$/,
    is_truth:       /^(?:true|yes|ok|enabled|on|1)$/i,
    is_array:       /(.+)\[\]$/,
};

const cfreader = exports;

cfreader.watch_files = true;
cfreader._config_cache = {};
cfreader._read_args = {};
cfreader._watchers = {};
cfreader._enoent_timer = false;
cfreader._enoent_files = {};
cfreader._sedation_timers = {};
cfreader._overrides = {};

let config_dir_candidates = [
    // these work when this file is loaded as require('./config.js')
    path.join(__dirname, 'config'),    // Haraka ./config dir
    __dirname,                         // npm packaged plugins
];

cfreader.get_path_to_config_dir = function () {
    if (process.env.HARAKA) {
        // console.log('process.env.HARAKA: ' + process.env.HARAKA);
        cfreader.config_path = path.join(process.env.HARAKA, 'config');
        return;
    }

    if (process.env.NODE_ENV === 'test') {
        // loaded by haraka-config/test/*
        cfreader.config_path = path.join(__dirname, 'test', 'config');
        return;
    }

    // these work when this is loaded with require('haraka-config')
    if (/node_modules[\\/]haraka-config$/.test(__dirname)) {
        config_dir_candidates = [
            path.join(__dirname, '..', '..', 'config'),  // haraka/Haraka/*
            path.join(__dirname, '..', '..'),            // npm packaged modules
        ]
    }

    for (let i=0; i < config_dir_candidates.length; i++) {
        const candidate = config_dir_candidates[i];
        try {
            const stat = fs.statSync(candidate);
            if (stat && stat.isDirectory()) {
                cfreader.config_path = candidate;
                return;
            }
        }
        catch (ignore) {
            console.error(ignore.message);
        }
    }
}
exports.get_path_to_config_dir();
// console.log('cfreader.config_path: ' + cfreader.config_path);

cfreader.on_watch_event = function (name, type, options, cb) {
    return function (fse, filename) {
        if (cfreader._sedation_timers[name]) {
            clearTimeout(cfreader._sedation_timers[name]);
        }
        cfreader._sedation_timers[name] = setTimeout(function () {
            console.log('Reloading file: ' + name);
            cfreader.load_config(name, type, options);
            delete cfreader._sedation_timers[name];
            if (typeof cb === 'function') cb();
        }, 5 * 1000);

        if (fse !== 'rename') return;
        // https://github.com/joyent/node/issues/2062
        // After a rename event, re-watch the file
        cfreader._watchers[name].close();
        try {
            cfreader._watchers[name] = fs.watch(
                name,
                { persistent: false },
                cfreader.on_watch_event(name, type, options, cb));
        }
        catch (e) {
            if (e.code === 'ENOENT') {
                cfreader._enoent_files[name] = true;
                cfreader.ensure_enoent_timer();
            }
            else {
                console.error('Error watching file: ' + name + ' : ' + e);
            }
        }
    };
};

cfreader.watch_dir = function () {
    // NOTE: Has OS platform limitations:
    // https://nodejs.org/api/fs.html#fs_fs_watch_filename_options_listener
    const cp = cfreader.config_path;
    if (cfreader._watchers[cp]) return;

    const watcher = function (fse, filename) {
        if (!filename) return;
        const full_path = path.join(cp, filename);
        if (!cfreader._read_args[full_path]) return;
        const args = cfreader._read_args[full_path];
        if (args.options && args.options.no_watch) return;
        if (cfreader._sedation_timers[filename]) {
            clearTimeout(cfreader._sedation_timers[filename]);
        }
        cfreader._sedation_timers[filename] = setTimeout(function () {
            console.log('Reloading file: ' + full_path);
            cfreader.load_config(full_path, args.type, args.options);
            delete cfreader._sedation_timers[filename];
            if (typeof args.cb === 'function') args.cb();
        }, 5 * 1000);

    };
    try {
        cfreader._watchers[cp] = fs.watch(cp, { persistent: false }, watcher);
    }
    catch (e) {
        console.error('Error watching directory ' + cp + '(' + e + ')');
    }
    return;
};

cfreader.watch_file = function (name, type, cb, options) {
    // This works on all OS's, but watch_dir() above is preferred for Linux and
    // Windows as it is far more efficient.
    // NOTE: we need a fs.watch per file. It's impossible to watch non-existent
    // files. Instead, note which files we attempted
    // to watch that returned ENOENT and fs.stat each periodically
    if (cfreader._watchers[name] || (options && options.no_watch)) return;
    try {
        cfreader._watchers[name] = fs.watch(
            name, {persistent: false},
            cfreader.on_watch_event(name, type, options, cb));
    }
    catch (e) {
        if (e.code !== 'ENOENT') { // ignore error when ENOENT
            console.error('Error watching config file: ' + name + ' : ' + e);
        }
        else {
            cfreader._enoent_files[name] = true;
            cfreader.ensure_enoent_timer();
        }
    }
    return;
};

cfreader.get_cache_key = function (name, options) {

    // Ignore options etc. if this is an overriden value
    if (cfreader._overrides[name]) return name;

    if (options) {
        // this ordering of objects isn't guaranteed to be consistent, but I've
        // heard that it typically is.
        return name + JSON.stringify(options);
    }

    if (cfreader._read_args[name] && cfreader._read_args[name].options) {
        return name + JSON.stringify(cfreader._read_args[name].options);
    }

    return name;
}

cfreader.read_config = function (name, type, cb, options) {
    // Store arguments used so we can:
    // 1. re-use them by filename later
    // 2. to know which files we've read, so we can ignore
    //    other files written to the same directory.

    cfreader._read_args[name] = {
        type: type,
        cb: cb,
        options: options
    };

    // Check cache first
    if (!process.env.WITHOUT_CONFIG_CACHE) {
        const cache_key = cfreader.get_cache_key(name, options);
        // console.log('\tcache_key: ' + cache_key);
        if (cfreader._config_cache[cache_key] !== undefined) {
            // console.log('\t' + name + ' is cached');
            return cfreader._config_cache[cache_key];
        }
    }

    // load config file
    const result = cfreader.load_config(name, type, options);
    if (!cfreader.watch_files) return result;

    // We can watch the directory on these platforms which
    // allows us to notice when files are newly created.
    switch (process.platform) {
        case 'win32':
        case 'win64':
        case 'linux':
            cfreader.watch_dir();
            break;
        default:
            // All other operating systems
            cfreader.watch_file(name, type, cb, options);
    }

    return result;
};

function isDirectory (filepath) {
    return new Promise(function (resolve, reject) {
        fs.stat(filepath, function (err, stat) {
            if (err) return reject(err);
            resolve(stat.isDirectory());
        })
    })
}

function fsReadDir (filepath) {
    return new Promise(function (resolve, reject) {
        fs.readdir(filepath, function (err, fileList) {
            if (err) return reject(err);
            resolve(fileList);
        })
    })
}

function fsWatchDir (dirPath) {

    if (cfreader._watchers[dirPath]) return;

    cfreader._watchers[dirPath] = fs.watch(dirPath, { persistent: false }, function (fse, filename) {
        // console.log('event: ' + fse + ', ' + filename);
        if (!filename) return;
        const full_path = path.join(dirPath, filename);
        const args = cfreader._read_args[dirPath];
        // console.log(args);
        if (cfreader._sedation_timers[full_path]) {
            clearTimeout(cfreader._sedation_timers[full_path]);
        }
        cfreader._sedation_timers[full_path] = setTimeout(function () {
            delete cfreader._sedation_timers[full_path];
            args.opts.watchCb();
        }, 2 * 1000);
    });
}

cfreader.read_dir = function (name, opts, done) {

    cfreader._read_args[name] = { opts: opts }
    const type = opts.type || 'binary';

    isDirectory(name)
        .then((result) => {
            return fsReadDir(name);
        })
        .then((fileList) => {
            const reader = require('./readers/' + type);
            const promises = [];
            fileList.forEach((file) => {
                promises.push(reader.loadPromise(path.resolve(name, file)))
            });
            return Promise.all(promises);
        })
        .then((fileList) => {
            // console.log(fileList);
            done(null, fileList);
        })
        .catch((error) => {
            done(error);
        })

    if (opts.watchCb) fsWatchDir(name);
};

cfreader.ensure_enoent_timer = function () {
    if (cfreader._enoent_timer) return;
    // Create timer
    cfreader._enoent_timer = setInterval(function () {
        const files = Object.keys(cfreader._enoent_files);
        for (let i=0; i<files.length; i++) {
            const fileOuter = files[i];
            /* BLOCK SCOPE */
            (function (file) {
                fs.stat(file, function (err) {
                    if (err) return;
                    // File now exists
                    delete(cfreader._enoent_files[file]);
                    const args = cfreader._read_args[file];
                    cfreader.load_config(
                        file, args.type, args.options, args.cb);
                    cfreader._watchers[file] = fs.watch(
                        file, {persistent: false},
                        cfreader.on_watch_event(
                            file, args.type, args.options, args.cb));
                });
            })(fileOuter); // END BLOCK SCOPE
        }
    }, 60 * 1000);
    cfreader._enoent_timer.unref(); // This shouldn't block exit
};

cfreader.get_filetype_reader = function (type) {
    switch (type) {
        case 'list':
        case 'value':
        case 'data':
        case '':
            return require('./readers/flat');
    }
    return require('./readers/' + type);
};

cfreader.load_config = function (name, type, options) {
    let result;

    if (!type) {
        type = path.extname(name).toLowerCase().substring(1);
    }

    let cfrType = cfreader.get_filetype_reader(type);

    if (!fs.existsSync(name)) {

        if (!/\.json$/.test(name)) {
            return cfrType.empty(options, type);
        }

        const yaml_name = name.replace(/\.json$/, '.yaml');
        if (!fs.existsSync(yaml_name)) {
            return cfrType.empty(options, type);
        }

        name = yaml_name;
        type = 'yaml';
        cfrType = cfreader.get_filetype_reader(type);
    }

    const cache_key = cfreader.get_cache_key(name, options);
    try {
        switch (type) {
            case 'ini':
                result = cfrType.load(name, options, regex);
                break;
            case 'json':
            case 'yaml':
                result = cfrType.load(name);
                cfreader.process_file_overrides(name, options, result);
                break;
            // case 'binary':
            default:
                result = cfrType.load(name, type, options, regex);
        }
        cfreader._config_cache[cache_key] = result;
    }
    catch (err) {
        console.error(err.message);
        if (cfreader._config_cache[cache_key]) {
            return cfreader._config_cache[cache_key];
        }
        return cfrType.empty(options, type);
    }
    return result;
};

cfreader.process_file_overrides = function (name, options, result) {
    // We might be re-loading this file:
    //     * build a list of cached overrides
    //     * remove them and add them back
    const cp = cfreader.config_path;
    const cache_key = cfreader.get_cache_key(name, options);
    if (cfreader._config_cache[cache_key]) {
        const ck_keys = Object.keys(cfreader._config_cache[cache_key]);
        for (let i=0; i<ck_keys.length; i++) {
            if (ck_keys[i].substr(0,1) !== '!') continue;
            delete cfreader._config_cache[path.join(cp, ck_keys[i].substr(1))];
        }
    }

    // Allow JSON files to create or overwrite other config file data
    // by prefixing the outer variable name with ! e.g. !smtp.ini
    const keys = Object.keys(result);
    for (let j=0; j<keys.length; j++) {
        if (keys[j].substr(0,1) !== '!') continue;
        const fn = keys[j].substr(1);
        // Overwrite the config cache for this filename
        console.log(`Overriding file ${fn} with config from ${name}`);
        cfreader._config_cache[path.join(cp, fn)] = result[keys[j]];
    }
};
