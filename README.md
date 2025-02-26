# haraka-config

Haraka config file loader, parser, and watcher.

# Config Files

## Config file type/formats

Haraka's config loader can load several types of configuration files.

- value - load a flat file containing a single value (default)
- ini - load an ini file
- json - load a json file
- hjson - load a hjson file
- yaml - load a yaml file
- list - load a flat file containing a list of values
- data - load a flat file containing a list, keeping comments and whitespace.
- binary - load a binary file into a Buffer

See the [File Formats](#file_formats) section below for a more detailed
explanation of each of the formats.

# Usage

```js
// From within a plugin:
const cfg = this.config.get(name, [type], [callback], [options])
```

This will load the file config/rambling.paths in the Haraka directory.

`name` is not a full path, but a filename in the config/ directory. For example:

```js
const cfg = this.config.get('rambling.paths', 'list')
```

`type` can be any of the types listed above.

If the file name has an `.ini`, `.json` or `.yaml` suffix,
the `type` parameter can be omitted.

`callback` is an optional callback function that will be called when
an update is detected on the file after the configuration cache has been
updated by re-reading the file. Use this to refresh configuration
variables within your plugin. Example:

```js
exports.register = function () {
  this.loginfo('register called')
  this.load_my_plugin_ini()
}

exports.load_my_plugin_ini = function () {
  this.cfg = this.config.get('my_plugin.ini', () => {
    // This closure is run a few seconds after my_plugin.ini changes
    // Re-run the outer function again
    this.load_my_plugin_ini()
  })
  this.loginfo(`cfg=${JSON.stringify(this.cfg)}`)
}

exports.hook_connect = function (next, connection) {
  // this.cfg here will be kept updated
}
```

The `options` object can accepts the following keys:

- `no_watch` (default: false) - prevents Haraka from watching for updates.
- `no_cache` (default: false) - prevents Haraka from caching the file. The file will be re-read on every call to `config.get`. This is not recommended as config files are read syncronously and will slow down Haraka.
- `booleans` (default: none) - for .ini files, this allows specifying boolean type keys. Default true or false can be specified.

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

- For `json`, `ini` and `yaml` config, values are overridden on a deep
  key by key basis.
- For every other config format, an override file replaces the entire
  config.
- If `smtp.json` or `smtp.yaml` exist, their contents will be loaded before all other config files. You can make use of [JSON Overrides](#json-overrides) here for a single file config.

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

This allows plugins to ship a default config and users can override
values on a key-by-key basis.

# <a name="file_formats">File Formats</a>

## Ini Files

[INI files](https://en.wikipedia.org/wiki/INI_file) are key=value pairs, with optional [sections]. A typical example:

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

Items before any `[section]` marker are in the implicit `[main]` section.

Some values on the right hand side of the equals are converted:

- integers are converted to integers
- floats are converted to floats.

The key=value pairs support continuation lines using the backslash "\" character.

The `options` object allows you to specify which keys are boolean:

```js
{
  booleans: ['reject', 'some_true_value']
}
```

On the options declarations, key names are formatted as section.key.
If the key name does not specify a section, it is presumed to be `[main]`.

Declaring booleans ensures that values are converted as boolean when parsed, and supports the following options for boolean values:

```
true, yes, ok, enabled, on, 1
```

Anything else is treated as false.

To default a boolean as true (when the key is undefined or the config file is
missing), prefix the key with +:

```js
{
  booleans: ['+reject']
}
```

For completeness the inverse is also allowed:

```js
{
  booleans: ['-reject']
}
```

Lists are supported using this syntax:

```ini
hosts[] = first_host
hosts[] = second_host
hosts[] = third_host
```

which produces this javascript array:

<!-- prettier-ignore -->
```js
['first_host', 'second_host', 'third_host']
```

## Flat Files

Flat files are simply either lists of values separated by \n or a single value in a file on its own. Qmail or qpsmtpd users will be familiar with this format. Lines starting with '#' and blank lines will be ignored unless the type is specified as 'data', however even then line endings will be stripped.

## JSON Files

These are as you would expect, and return an object as given in the file.

If a requested .json or .hjson file does not exist then the same file will be checked for with a .yaml extension and that will be loaded instead. This is done because YAML files are far easier for a human to write.

### <a name="json-overrides">JSON Overrides</a>

You can use JSON, HJSON or YAML files to override any other file by prefixing the outer variable name with a `!` e.g.

```js
{
  "!smtpgreeting": ['this is line one', 'this is line two'],
  "!smtp.ini": {
    main: {
      nodes: 0,
    },
    headers: {
      max_lines: 1000,
      max_received: 100,
    },
  },
  "!custom-plugin.yaml": {
    secret: 'example',
  },
}
```

If the config/smtpgreeting wasn't loaded before, then this value would replace it. Since `smtp.json` is always loaded first, it can be used to override existing config files.

NOTE: You must ensure that the data type (e.g. Object, Array or String) for the replaced value is correct. This cannot be done automatically.

## Hjson Files

Hjson is a syntax extension to JSON. It is intended to be used like a user interface for humans, to read and edit before passing the JSON data to the machine. That means you can use it to parse JSON files but it is not intended as a replacement.

You can check [Hjson's homepage](https://hjson.github.io/) to get familiar with it and you can [try out its syntax](https://hjson.github.io/try.html).

Main features:

- Comments
- Optional quotes
- Optional commas
- Heredoc

Example syntax

```hjson
{
  # specify rate in requests/second (because comments are helpful!)
  rate: 1000

  // prefer c-style comments?
  /* feeling old fashioned? */

  # did you notice that rate does not need quotes?
  hey: look ma, no quotes for strings either!

  # best of all
  notice: []
  anything: ?

  # yes, commas are optional!
}
```

NOTE: Hjson can be also replaced by a YAML configuration file. You can find more on this issue under JSON section.

## YAML Files

As per JSON files above but in YAML format.

# Reloading/Caching

Haraka automatically reloads configuration files, but this only works if whatever is looking at that config re-calls config.get() to retrieve the new config. Providing a callback in the config.get() call is the most efficient method to do this.

Configuration files are watched for changes using filesystem events which are inexpensive. Due to caching, calling config.get() is normally a lightweight process.

On Linux/Windows, newly created files that Haraka has tried to read in the past will be noticed immediately and loaded. For other operating systems, it may take up to 60 seconds to load, due to differences between in the kernel APIs for watching files/directories.

Haraka reads a number of configuration files at startup. Any files read in a plugins register() function are read _before_ Haraka drops privileges. Be sure that Haraka's user/group has permission to read these files else Haraka will be unable to update them after changes.
