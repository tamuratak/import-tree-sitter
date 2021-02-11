import * as fs from 'fs'
import {importGrammar} from '../import'

const filename = process.argv.pop()

if (!filename || !fs.existsSync(filename)) {
    console.error(`${filename} not found.`)
    process.exit(1)
}

const s = fs.readFileSync(filename, {encoding: 'utf8'})

console.log(importGrammar(s))

