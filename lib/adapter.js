import fs from 'fs';
import path from 'path';
import { _path } from './path.js';

const packagePath = path.join(_path, 'package.json');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));


const adapter = packageJson.name === 'miao-yunzai' ? 0 : packageJson.name === 'trss-yunzai' ? 1 : undefined;

export default adapter;