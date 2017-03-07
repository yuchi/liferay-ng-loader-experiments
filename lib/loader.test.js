
const glob = require('glob');
const path = require('path');
const fs = require('fs');

const concat = (a, b) => a.concat(b);

const packages = glob.sync('fixtures/*/*').map(pathname => {
    const pkg = JSON.parse(fs.readFileSync(
        path.join(pathname, 'package.json'),
        'utf8')
    );

    return Object.assign({
        dependencies: {},
        peerDependencies: {},
        modules: glob.sync(path.join(pathname, '**', '*')).map(filename => ({
            filename,
            local: path.relative(pathname, filename),
            content: fs.readFileSync(filename, 'utf8')
        }))
    }, pkg);
});

const Loader = require('./loader');

const loader = new Loader(packages);

test('Should work', () => {
    expect(loader.execute('app1@1.0.0', 'index.js')).toMatchSnapshot();
});

test('Should work', () => {
    expect(loader.execute('app2@1.0.0', 'index.js')).toMatchSnapshot();
});

test('Should work', () => {
    expect(loader.execute('app3@1.0.0', 'index.js')).toMatchSnapshot();
});

test('Should throw with circular peerDependencies', () => {
    expect(() => {
        loader.execute('app4@1.0.0', 'index.js');
    }).toThrowErrorMatchingSnapshot();
});
