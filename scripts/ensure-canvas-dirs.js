const fs = require('fs');
const path = require('path');

const dirs = [
    'node_modules/@napi-rs/canvas-android-arm64'
];

dirs.forEach(dir => {
    const fullPath = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
        console.log(`Creating dummy directory: ${fullPath}`);
        fs.mkdirSync(fullPath, { recursive: true });
    }
});
