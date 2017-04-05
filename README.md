[![Build Status][ci-img]][ci-url]
[![Coverage Status][cov-img]][cov-url]
[![Code Climate][clim-img]][clim-url]
[![Windows Build status][apv-img]][apv-url]
[![Greenkeeper badge][gk-img]][gk-url]

# haraka-config

Haraka config file loader, parser, and watcher.

# Config Files

## Config file type/formats

Haraka's config loader can load several types of configuration files.

* 'value' - load a flat file containing a single value (default)
* 'ini'   - load an ini file
* 'json'  - load a json file
* 'yaml'  - load a yaml file
* 'list'  - load a flat file containing a list of values
* 'data'  - load a flat file containing a list of values, keeping comments and whitespace.
* 'binary' - load a binary file into a Buffer

See the [File Formats](#file_formats) section below for a more detailed
explanation of each of the formats.

# Usage
```js
    // From within a plugin:
    var cfg = this.config.get(name, [type], [callback], [options]);
```
This will load the file config/rambling.paths in the Haraka directory.

`name` is not a full path, but a filename in the config/ directory. For example:
```js
    var cfg = this.config.get('rambling.paths', 'list');
```
`type` can be any of the types listed above.

If the file name has an `.ini`, `.json` or `.yaml` suffix,
the `type` parameter can be omitted.

`callback` is an optional callback function that will be called when
an update is detected on the file after the configuration cache has been
updated by re-reading the file.  Use this to refresh configuration
variables within your plugin. Example:

```js
exports.register = function () {
    var plugin = this;
    plugin.loginfo('register function called');
    plugin.load_my_plugin_ini();
}

exports.load_my_plugin_ini = function () {
    var plugin = this;
    plugin.cfg = plugin.config.get('my_plugin.ini', function onCfgChange () {
        // This closure is run a few seconds after my_plugin.ini changes
        // Re-run the outer function again
        plugin.load_my_plugin_ini();
    });
    plugin.loginfo('cfg=' + JSON.stringify(plugin.cfg));
}

exports.hook_connect = function (next, connection) {
    // plugin.cfg here will be kept updated
}
```

The `options` object can accepts the following keys:

* `no_watch` (default: false) - prevents Haraka from watching for updates.
* `no_cache` (default: false) - prevents Haraka from caching the file. This
means that the file will be re-read on every call to `config.get`.  This is
not recommended as config files are read syncronously, will block the event
loop, and will slow down Haraka.
* `booleans` (default: none) - for .ini files, this allows specifying
boolean type keys. Default true or false can be specified.

## <a name="overrides">Default Config and Overrides</a>

The config loader supports dual config files - a file containing defaults,
and another user installed file containing overrides. The default configs
reside:

- Haraka: within the config directory in the Haraka install (where `npm i`
installed Haraka)
- NPM plugins - inside the module/config directory

Config files with overrides are **always** installed in the Haraka config
directory, which you specified when you ran `haraka -i`.

Overrides work in the following manner:

* For `json`, `ini` and `yaml` config, values are overridden on a deep
key by key basis.
* For every other config format, an override file replaces the entire
config.

## Examples

1. a plugin installed as a module (or a core Haraka plugin)
loads a `list` config from their own `config/plugin_name` file. That list
can be completely overridden by a file called `config/plugin_name` in the
Haraka local install directory.

2. a plugin using default config from `config/plugin_name.ini`
can be overridden on a key-by-key basis. A default
`plugin_name.ini` might contain:

```ini
toplevel1=foo
toplevel2=bar

[subsection]
sub1=something
```

And the local `plugin_name.ini` might contain:

```ini
toplevel2=blee

[subsection]
sub2=otherthing
```

This would be the equivalent of loading config containing:

```ini
toplevel1=foo
toplevel2=blee

[subsection]
sub1=something
sub2=otherthing
```

This allows plugins to provide a default config, and allow users to override
values on a key-by-key basis.

<a name="file_formats">File Formats</a>
============

Ini Files
---------

INI files have their heritage in early versions of Microsoft Windows.
Entries are a simple format of key=value pairs, with optional [sections].

Here is a typical example:
```ini
    first_name=Matt
    last_name=Sergeant

    [job]
    title=Senior Principal Software Engineer
    role=Architect

    [projects]
    haraka
    qpsmtpd
    spamassassin
```
That produces the following Javascript object:

```js
{
    main: {
        first_name: 'Matt',
        last_name: 'Sergeant'
    },
    job: {
        title: 'Senior Principal Software Engineer',
        role: 'Architect'
    },
    projects: {
        haraka: undefined,
        qpsmtpd: undefined,
        spamassassin: undefined,
    }
}
```

Items before any [section] marker are in the implicit [main] section.

There is some auto-conversion of values on the right hand side of
the equals: integers are converted to integers, floats are converted to
floats.

The key=value pairs support continuation lines using the
backslash "\" character.

The `options` object allows you to specify which keys are boolean:
```js
    { booleans: ['reject','some_true_value'] }
```
On the options declarations, key names are formatted as section.key.
If the key name does not specify a section, it is presumed to be [main].

This ensures these values are converted to true Javascript booleans when parsed,
and supports the following options for boolean values:
```
    true, yes, ok, enabled, on, 1
```
Anything else is treated as false.

To default a boolean as true (when the key is undefined or the config file is
missing), prefix the key with +:
```js
    { booleans: [ '+reject' ] }
```
For completeness the inverse is also allowed:
```js
    { booleans: [ '-reject' ] }
```
Lists are supported using this syntax:
```ini
    hosts[] = first_host
    hosts[] = second_host
    hosts[] = third_host
```
which produces this javascript array:
```js
    ['first_host', 'second_host', 'third_host']
```

Flat Files
----------

Flat files are simply either lists of values separated by \n or a single
value in a file on its own. Those who have used qmail or qpsmtpd will be
familiar with this format.
Lines starting with '#' and blank lines will be ignored unless the type is
specified as 'data', however even then line endings will be stripped.
See plugins/dnsbl.js for an example.

JSON Files
----------

These are as you would expect, and returns an object as given in the file.

If a requested .json file does not exist then the same file will be checked
for with a .yaml extension and that will be loaded instead.   This is done
because YAML files are far easier for a human to write.

You can use JSON or YAML files to override any other file by prefixing the
outer variable name with a `!` e.g.

```js
{
    "!smtpgreeting": [ 'this is line one', 'this is line two' ]
}
```

If the config/smtpgreeting file did not exist, then this value would replace
it.

NOTE: You must ensure that the data type (e.g. Object, Array or String) for
the replaced value is correct.  This cannot be done automatically.

YAML Files
----------

As per JSON files above but in YAML format.


Reloading/Caching
========

Haraka automatically reloads configuration files, but this only works if
whatever is looking at that config re-calls config.get() to retrieve the
new config. Providing a callback in the config.get() call is the most
efficient method to do this.

Configuration files are watched for changes using filesystem events which
are inexpensive. Due to caching, calling config.get() is normally a
lightweight process.

On Linux/Windows, newly created files that Haraka has tried to read in the
past will be noticed immediately and loaded. For other operating systems,
it may take up to 60 seconds to load, due to differences between in the
kernel APIs for watching files/directories.

Haraka reads a number of configuration files at startup. Any files read
in a plugins register() function are read *before* Haraka drops privileges.
Be sure that Haraka's user/group has permission to read these files else
Haraka will be unable to update them after changes.


[ci-img]: https://travis-ci.org/haraka/haraka-config.svg?branch=master
[ci-url]: https://travis-ci.org/haraka/haraka-config
[cov-img]: https://codecov.io/github/haraka/haraka-config/coverage.svg
[cov-url]: https://codecov.io/github/haraka/haraka-config?branch=master
[clim-img]: https://codeclimate.com/github/haraka/haraka-config/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/haraka/haraka-config
[apv-img]: https://ci.appveyor.com/api/projects/status/9qh720gq77e2h5x4?svg=true
[apv-url]: https://ci.appveyor.com/project/msimerson/haraka-config
[gk-img]: https://badges.greenkeeper.io/haraka/haraka-config.svg
[gk-url]: https://greenkeeper.io/
