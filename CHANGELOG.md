# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/).

### Unreleased

### [1.3.0] - 2024-05-02

- feat: getDir is now recursive

### [1.2.4] - 2024-04-26

- fix(watch): callback was losing context. Use explicit obj
- fix(reader): use path.sep instead of [\\/] to be more obvious

### [1.2.2] - 2024-04-24

- feat: getDir can parse different types of files in a dir
- feat: all file readers now have load and loadPromise, so that
  a feature like getDir can safely use the nicer promise API
- chore: require syntax, prefix node builtins with `node:`
- moved configfile -> lib/reader
- moved readers/ -> lib/readers
- refactored regex lib to lib/regex
- refactored watch functions into lib/watch
- es6
  - add several uses of `...` (spread operator / param collection)
  - replace `for i` with `for ... of`
  - consolidate all cases of type detection into configfile.getType
  - replace `new Promise` with async/await
  - use shortened array function syntax
- ci: update to shared haraka/.github
- dep: eslint-plugin-haraka -> @haraka/eslint-config
- lint: remove duplicate / stale rules from .eslintrc
- package.json: populate [files]
- deps: version bumps
- config: guard against prototype pollution

### [1.1.0] - 2022-05-27

- chore(ci): depend on shared GHA workflows
- chore(dep): eslint 6 -> 8
- chore(dep): mocha 8 -> 9

### 1.0.20 - 2021-09-01

- chore(dep): update YAML 3.13 -> 4.1 (#65)

### 1.0.19 - 2021-06-10

- configfile: disable watch dir when platform not mac or win
- configfile: convert to es6 class
- configfile.read_dir: promisify
- configfile: use simpler es6 `for..in` and `for..of`
- getDir tests, use os.EOL for comparison

### 1.0.18 - 2019-10-11

- add support for loading `.js` configurations

### 1.0.17 - 2018-12-19

- refactor ./config.js as an es6 class
- update README syntax and improve formatting
- use path.resolve instead of ./dir/file (2x)
- watch: recursive=true
- permit retrieval of fully qualified path

### 1.0.16 - 2018-11-02

- remove trailing ; from function declarations
- add config.getInt(filename, default_value)

### 1.0.15 - 2017-09-21

- additional test for 'missing json loads yaml'
- modify get_path_to_config_dir regex to also match windows paths
- add tests for get_path_to_config_dir
- configs w/o .ext or declared type default to flat
- add test for json/yaml !filename overloads

### 1.0.14 - 2017-09-19

- add \_\_dirname/../../config to config_dir_candidates for haraka/Haraka/tests/\*
- sync process.env.HARAKA_TEST_DIR from haraka/Haraka/config
- eslint no-var updates #25

### 1.0.13 - 2017-06-16

- lint updates for eslint 4

### 1.0.12 - 2017-05-21

- unref() the setInterval so that Haraka can gracefully exit

### 1.0.11 - 2017-03-04

- add config.getDir, loads all files in a directory

### 1.0.10 - 2017-02-05

- log error vs throw on bad YAML
- fix appveyor badge URL

### 1.0.9 - 2017-01-27

- config cache fix (see haraka/Haraka#1738)
- config: add overrides handling (sync with Haraka)
- configfile: add win64 watching (sync with Haraka)
- remove grunt
- use haraka-eslint plugin (vs local copy of .eslintrc)
- lint updates

### 1.0.8 - 2017-01-02

- version bump, lint updates & sync
- lint fixes

### 1.0.7 - 2016-11-17

- update tests for appveyor (Windows) compatibility #9

### 1.0.6 - 2016-11-10

- handle invalid .ini lines properly (skip them)

### 1.0.5 - 2016-10-25

- do not leave behind a `*` section in config (due to wildcard boolean)

### 1.0.3

- added wildcard boolean support
- reduce node required 4.3 -> 0.10.43

[1.1.0]: https://github.com/haraka/haraka-config/releases/tag/1.1.0
[1.2.0]: https://github.com/haraka/haraka-config/releases/tag/v1.2.0
[1.2.1]: https://github.com/haraka/haraka-config/releases/tag/v1.2.1
[1.2.2]: https://github.com/haraka/haraka-config/releases/tag/v1.2.2
[1.2.4]: https://github.com/haraka/haraka-config/releases/tag/v1.2.4
[1.3.0]: https://github.com/haraka/haraka-config/releases/tag/v1.3.0