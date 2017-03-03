
const semver = require('semver');
const path = require('path');
const vm = require('vm');

const execute = (filename, content, sandbox, options) => {
    const basename = path.basename(filename);
    const extname = path.extname(filename);

    if (extname === '.js') {
        vm.runInNewContext(content, sandbox, options);
    }
    else if (basename === 'package.json') {
        const pkg = JSON.parse(content);
        sandbox.module.exports = pkg.name + ' @ ' + pkg.version;
    }
    else if (extname === '.json') {
        sandbox.module.exports = JSON.parse(content);
    }

    return sandbox;
};

Object.prototype.log = function () {
    console.log(this);
    return this;
};

class Loader {

    constructor(packages) {
        this.cache = {};
        this.packages = packages;
    }

    execute(packageName, packageRange, moduleName, parentResDeps = {}) {
        const pkg = this.resolvePackage(packageName, packageRange);

        const resolvedDependencies = Object.assign(
            parentResDeps,
            this.resolveDependencies(pkg.dependencies)
        );

        const resolvePeerDependencies = this.resolveDependencies(
            pkg.peerDependencies,
            Object.values(parentResDeps)
        );

        const peerKey = Object.values(resolvePeerDependencies)
            .map(pkg => `${pkg.name}@${pkg.version}`);

        const key = `${pkg.name}@${pkg.version}{${peerKey}}/${moduleName}`;

        if (key in this.cache) {
            return this.cache[key];
        }

        console.log('Executing', key);

        const { modules } = pkg;

        const found = modules.filter(module => module.local === moduleName)[0];

        const sandbox = execute(found.filename, found.content, {
            module: { exports: {} },
            require: (name) => {
                console.log('Requiring', name, 'from', key);

                const packageName = name.split('/')[0];
                const moduleName = name.slice(packageName.length + 1);

                const resolved = resolvedDependencies[packageName];

                if (!resolved) {
                    throw new Error(`Cannot find module ${name}`);
                }

                return this.execute(
                    resolved.name,
                    resolved.version,
                    moduleName,
                    resolvedDependencies
                );
            }
        }, {
            filename: module.filename
        });

        return this.cache[key] = sandbox.module.exports;
    }

    resolveDependencies(dependencies, packages) {
        return Object.entries(dependencies || {}).reduce((acc, [ name, range ]) => {
            acc[name] = this.resolvePackage(name, range, packages);
            return acc;
        }, {});
    }

    /*resolvePackageTree(name, range) {
        return this.resolvePackageTree_(name, range, {
            parent: null
        });
    }

    resolvePackageTree_(name, range, context) {
        const pkg = this.resolvePackage(name, range);

        const dependencies = Object.entries(pkg.dependencies)
            .map(([ name, range ]) => this.resolvePackage(name, range))
            //……;

        return { package: pkg, dependencies };
    }*/

    resolvePackage(packageName, packageRange, packages = this.packages) {
        const candidates = packages
            .filter(p => p.name === packageName)
            .filter(p => semver.satisfies(p.version, packageRange))
            .sort((a, b) => semver.rcompare(a.version, b.version));

        if (!candidates.length) {
            throw new TypeError(
                `Couldn't find any package with name '${packageName}' at version '${packageRange}'`
            );
        }

        return candidates[0];
    }

}

module.exports = Loader;
