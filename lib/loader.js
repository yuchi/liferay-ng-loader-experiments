
const semver = require('semver');
const path = require('path');
const vm = require('vm');

const execute = (filename, content, sandbox, options) => {
    const basename = path.basename(filename);
    const extname = path.extname(filename);

    if (basename === 'package.json') {
        // Debug information only
        const pkg = JSON.parse(content);
        sandbox.module.exports = pkg.name + ' @ ' + pkg.version;
    }
    else if (extname === '.js') {
        vm.runInNewContext(content, sandbox, options);
    }
    else if (extname === '.json') {
        sandbox.module.exports = JSON.parse(content);
    }

    return sandbox;
};

// TODO Scoped packages
const qualifiedToResolved = qualifiedName => qualifiedName.split('{')[0];

Object.prototype.log = function () {
    console.log(this);
    return this;
};

class Loader {

    constructor(packages) {
        this.cache = {};
        this.packages = packages;
        this.index = packages.reduce((accumulator, pkg) => {
            accumulator[`${pkg.name}@${pkg.version}`] = pkg;
            return accumulator;
        }, {});
    }

    execute(qualifiedName, moduleName, parentQualifiedDependencies = {}) {
        const key = `${qualifiedName}/${moduleName}`;

        if (key in this.cache) {
            return this.cache[key];
        }

        const resolvedName = qualifiedToResolved(qualifiedName);

        const pkg = this.index[resolvedName];

        if (!pkg) {
            throw new Error(
                `Cannot find package with qualified name '${qualifiedName}'`
            );
        }

        const { qualifiedDependencies } = this.resolvePackageTree(
            pkg.dependencies, parentQualifiedDependencies
        );

        const { modules } = pkg;

        const found = modules.filter(module => module.local === moduleName)[0];

        if (!found) {
            throw new Error(
                `Cannot find module '${moduleName}' for package '${resolvedName}'`
            );
        }

        const sandbox = execute(found.filename, found.content, {
            __key: Buffer.from(key).toString('base64'),
            module: { exports: {} },
            require: (name) => {
                // TODO Scoped packages
                const packageName = name.split('/')[0];
                const moduleName = name.slice(packageName.length + 1);

                const qualifiedName = qualifiedDependencies[packageName];

                if (!qualifiedName) {
                    throw new Error(`Cannot find module ${name}`);
                }

                return this.execute(
                    qualifiedName,
                    moduleName,
                    qualifiedDependencies
                );
            }
        }, {
            filename: module.filename
        });

        return this.cache[key] = sandbox.module.exports;
    }

    resolvePackageTree(dependencies, parentQualifiedDependencies) {
        const resolvedDependencies = this.resolveDependencies(dependencies);
        const qualifiedDependencies = Object.assign(
            parentQualifiedDependencies,
            this.qualifyDependencies(
                resolvedDependencies, parentQualifiedDependencies
            )
        );

        return { resolvedDependencies, qualifiedDependencies };
    }

    qualifyDependencies(resolvedMap, parentQualifiedDependencies) {
        const accumulator = {};

        let entries = Object.entries(resolvedMap).sort(
            ([nameA], [nameB]) => nameA.localeCompare(nameB)
        );

        let guard = 0;

        while (entries.length && (guard !== entries.length)) {
            guard = entries.length;
            entries = entries.filter(entry => {
                const [ name, pkg ] = entry;

                // We are trying to qualify a dependency which could have
                // its own peerDependencies. Its qualified name will be in
                // fact be the sum of
                // - its name,
                // - its version,
                // - its eventualual peers’ qualified name

                const peers = Object.entries(pkg.peerDependencies).map(([ peerName, peerRange ]) => {

                    // We are trying to get the qualified name of a peer.

                    const peerPkg = resolvedMap[peerName];

                    if (!peerPkg) {
                        const key = parentQualifiedDependencies[peerName];

                        if (key) {
                            return { key }
                        }
                        else {
                            throw new Error(
                                `Couldn't qualify the peer dependency for '${peerName}' at version '${peerRange}'`
                            );
                        }
                    }

                    const peerHasPeers = Object.values(peerPkg.peerDependencies).length;

                    if (peerHasPeers && !accumulator[peerName]) {
                        return { recurse: true };
                    }

                    if (!semver.satisfies(peerPkg.version, peerRange)) {
                        console.warn(
                            `Peer dependency '${peerPkg.name}@${peerPkg.version}' of '${pkg.name}@${pkg.version}' doesn’t satisfy version range '${peerRange}'`
                        );
                    }

                    const key = accumulator[peerName] || `${peerPkg.name}@${peerPkg.version}`;

                    return { key };
                });

                if (peers.some(p => p.recurse)) {
                    return true;
                }

                const peerKey = peers.map(p => p.key);

                accumulator[name] = `${pkg.name}@${pkg.version}{${peerKey}}`;
            });
        }

        if (entries.length) {
            const missing = entries.map(([ name, pkg ]) => `${name}@${pkg.version}`);

            throw new Error(
                `Probable circular references in peerDependencies. Unqualified peers are '${missing.join(`', '`)}'`
            );
        }

        return Object.assign({}, parentQualifiedDependencies, accumulator);
    }

    resolveDependencies(dependencies) {
        return Object.entries(dependencies || {}).reduce((acc, [ name, range ]) => {
            acc[name] = this.resolvePackage(name, range);
            return acc;
        }, {});
    }

    resolvePackage(packageName, packageRange) {
        const candidates = this.resolveMatchingPackages(
            packageName,
            packageRange
        );

        if (!candidates.length) {
            throw new TypeError(
                `Couldn't find any package with name '${packageName}' at version '${packageRange}'`
            );
        }

        return candidates[0];
    }

    resolveMatchingPackages(packageName, packageRange) {
        return this.packages
            .filter(p => p.name === packageName)
            .filter(p => semver.satisfies(p.version, packageRange))
            .sort((a, b) => semver.rcompare(a.version, b.version));
    }

    /*execute(packageName, packageRange, moduleName, parentResDeps = {}) {
        const pkg = this.getPackage(packageName, packageRange, parentResDeps);

        const resolvedDependencies = Object.assign(
            parentResDeps,
            this.resolveDependencies(pkg.dependencies, parentResDeps)
        );

        const resolvePeerDependencies = this.resolveDependencies(
            pkg.peerDependencies,
            Object.values(parentResDeps)
        );

        console.log('');
        console.log('#EXEC', packageName, packageRange);
        console.log('#EXEC#resolvedDependencies', resolvedDependencies);
        console.log('#EXEC#resolvePeerDependencies', resolvePeerDependencies);
        console.log('');

        const peerKey = Object.values(resolvePeerDependencies);

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

                const resolvedParts = resolved.split(/[@\{]/g);

                return this.execute(
                    resolvedParts[0],
                    resolvedParts[1],
                    moduleName,
                    resolvedDependencies
                );
            }
        }, {
            filename: module.filename
        });

        return this.cache[key] = sandbox.module.exports;
    }

    resolveDependencies(dependencies, resolvedPackages) {
        return Object.entries(dependencies || {}).reduce((acc, [ name, range ]) => {
            acc[name] = this.resolvePackage(name, range, resolvedPackages);
            return acc;
        }, {});
    }

    getPackage(packageName, packageRange, resolvedPackages) {
        const resolved = this.resolvePackage(packageName, packageRange, resolvedPackages);

        const parts = resolved.split(/[@\{]/g);

        const candidates = this.packages.filter(
            pkg => (pkg.name === parts[0]) && (pkg.version === parts[1])
        );

        const candidate = candidates[0];

        return candidate;
    }

    resolvePackage(packageName, packageRange, resolvedPackages = {}) {
        const resolved = resolvedPackages[packageName];

        if (resolved) {
            const parts = resolved.split(/[@\{]/g);

            if (semver.satisfies(parts[1], packageRange)) {
                return resolved;
            }
        }

        const candidates = this.packages
            .filter(p => p.name === packageName)
            .filter(p => semver.satisfies(p.version, packageRange))
            .sort((a, b) => semver.rcompare(a.version, b.version));

        const candidate = candidates[0];

        if (!candidate) {
            throw new TypeError(
                `Couldn't find any package with name '${packageName}' at version '${packageRange}'`
            );
        }
        else {
            return `${candidate.name}@${candidate.version}`;
        }
    }*/

}

module.exports = Loader;
