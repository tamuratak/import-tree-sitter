"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importTest = exports.importGrammar = void 0;
var regexp_parser_literal_1 = require("regexp-parser-literal");
function prec(expr) {
    switch (expr.type) {
        case "CHOICE": return isOption(expr) ? 10 : 1;
        case "SEQ": return 2;
        case "REPEAT":
        case "REPEAT1": return 3;
        case "ALIAS": return expr.named ? 10 : prec(expr.content);
        case "FIELD": return prec(expr.content);
        default: return 10;
    }
}
function isOption(expr) {
    if (expr.members.length != 2)
        return null;
    var empty = expr.members.findIndex(function (e) { return e.type == "BLANK"; });
    if (empty < 0)
        return null;
    return expr.members[empty ? 0 : 1];
}
function choices(expr) {
    if (expr.type != "CHOICE")
        return [expr];
    return expr.members.reduce(function (a, b) { return a.concat(choices(b)); }, []);
}
function isPrec(expr) {
    return expr.type == "PREC" || expr.type == "PREC_RIGHT" || expr.type == "PREC_LEFT" || expr.type == "PREC_DYNAMIC";
}
function takePrec(expr) {
    var comment = "";
    while (isPrec(expr)) {
        var label = expr.type.slice(5).toLowerCase();
        comment += (comment ? " " : "") + (label ? label + " " : "") + expr.value;
        expr = expr.content;
    }
    return { expr: expr, comment: comment ? "/* precedence: " + comment + " */ " : "" };
}
var Context = /** @class */ (function () {
    function Context(def) {
        this.def = def;
        this.rules = Object.create(null);
        this.tokens = Object.create(null);
        this.skip = "";
        this.wordRE = null;
        this.wordRule = "";
        this.wordRuleName = "";
    }
    Context.prototype.translateInner = function (expr, token, outerPrec) {
        var inner = this.translateExpr(expr, token);
        return prec(expr) < outerPrec ? "(" + inner + ")" : inner;
    };
    Context.prototype.translateName = function (name) {
        if (name[0] != "_")
            return name[0].toUpperCase() + name.slice(1).replace(/_\w/g, function (m) { return m.slice(1).toUpperCase(); });
        if (name[1].toUpperCase() != name[1])
            return name[1] + name.slice(2).replace(/_\w/g, function (m) { return m.slice(1).toUpperCase(); });
        return name;
    };
    Context.prototype.translateExpr = function (expr, token) {
        var _this = this;
        var _a;
        switch (expr.type) {
            case "REPEAT":
            case "REPEAT1":
                return this.translateInner(expr.content, token, prec(expr)) + (expr.type == "REPEAT" ? "*" : "+");
            case "SYMBOL":
                return this.translateName(expr.name);
            case "CHOICE":
                var opt = isOption(expr);
                return opt ? this.translateInner(opt, token, 10) + "?"
                    : expr.members.map(function (e) { return _this.translateInner(e, token, prec(expr)); }).join(" | ");
            case "ALIAS": // FIXME this should override/drop the name of the inner expr, somehow
                if (token)
                    throw new RangeError("Alias expression in token");
                if (expr.named && (expr.content.type == "TOKEN" || expr.content.type == "IMMEDIATE_TOKEN"))
                    return this.defineToken(expr.value, expr.content.content);
                var inner = this.translateExpr(expr.content, token);
                return expr.named ? this.translateName(expr.value) + " { " + inner + " }" : inner;
            case "SEQ":
                return expr.members.map(function (e) { return _this.translateInner(e, token, 2); }).join(" ");
            case "STRING":
                if (!token && ((_a = this.wordRE) === null || _a === void 0 ? void 0 : _a.test(expr.value)))
                    return this.wordRuleName + "<" + JSON.stringify(expr.value) + ">";
                return JSON.stringify(expr.value);
            case "PATTERN":
                if (!token)
                    return this.defineToken(null, expr);
                return this.translateRegExp(expr.value);
            case "FIELD":
                return this.translateExpr(expr.content, token);
            case "TOKEN":
            case "IMMEDIATE_TOKEN":
                return this.defineToken(null, expr.content);
            case "BLANK":
                return '""';
            case "PREC":
            case "PREC_LEFT":
            case "PREC_RIGHT":
            case "PREC_DYNAMIC":
                var _b = takePrec(expr), innerExpr = _b.expr, comment = _b.comment;
                return comment + "(" + this.translateExpr(innerExpr, token) + ")";
            default:
                throw new RangeError("Unexpected expression type: " + expr.type);
        }
    };
    Context.prototype.isTokenish = function (expr) {
        var _this = this;
        var _a;
        return (expr.type == "STRING" && !((_a = this.wordRE) === null || _a === void 0 ? void 0 : _a.test(expr.value))) ||
            expr.type == "PATTERN" || expr.type == "BLANK" ||
            (expr.type == "SEQ" || expr.type == "CHOICE") && expr.members.every(function (e) { return _this.isTokenish(e); }) ||
            (expr.type == "REPEAT" || expr.type == "REPEAT1" || isPrec(expr)) && this.isTokenish(expr.content);
    };
    Context.prototype.translateRule = function (name, content, top) {
        var _this = this;
        if (!top && content.type == "TOKEN") {
            this.defineToken(name, content.content);
        }
        else if (!top && this.isTokenish(content)) {
            this.defineToken(name, content);
        }
        else {
            var _a = takePrec(content), comment = _a.comment, expr = _a.expr;
            var result = choices(expr).map(function (choice) { return _this.translateExpr(choice, false); });
            this.rules[(top ? "@top " : "") + this.translateName(name)] =
                comment + "{\n  " + result.join(" |\n  ") + "\n}";
        }
    };
    Context.prototype.translateRegExp = function (value) {
        var parsed = regexp_parser_literal_1.createRegExpParser().parsePattern(value);
        return this.translateRegExpElements(parsed.elements);
    };
    Context.prototype.translateRegExpElements = function (elts) {
        var result = "";
        for (var i = 0; i < elts.length;) {
            if (result)
                result += " ";
            var next = elts[i++];
            if (next.type == "Character") {
                var chars = next.raw;
                while (i < elts.length && elts[i].type == "Character")
                    chars += elts[i++].raw;
                result += JSON.stringify(chars);
            }
            else {
                result += this.translateRegExpElement(next);
            }
        }
        return result;
    };
    Context.prototype.translateRegExpElement = function (elt) {
        var _this = this;
        switch (elt.type) {
            case "Disjunction":
                return elt.alternatives.map(function (e) { return _this.translateRegExpElements(e); }).join(" | ");
            case "Group":
            case "CapturingGroup":
                return "(" + this.translateRegExpElements(elt.elements) + ")";
            case "Quantifier":
                var inner = this.translateRegExpElement(elt.element), min = elt.min, max = elt.max;
                if (min == 0 && max == 1)
                    return inner + "?";
                if (min == 0 && max == Infinity)
                    return inner + "*";
                if (min == 1 && max == Infinity)
                    return inner + "+";
                return (inner + " ").repeat(min) + (max == Infinity ? inner + "*" : (inner + "? ").repeat(max - min));
            case "CharacterClass":
                return (elt.negate ? "!" : "$") + "[" + elt.elements.map(function (r) {
                    switch (r.type) {
                        case "CharacterSet":
                            if (r.negate)
                                throw new Error("No support for negated character set elements");
                            if (r.kind == "digit")
                                return "0-9";
                            else if (r.kind == "space")
                                return " \\t\\n\\r";
                            else if (r.kind == "word")
                                return "a-zA-Z0-9_";
                            else
                                new Error("Unhandled range type: EscapeCharacterSet/property");
                        case "Character":
                            return r.raw;
                        case "CharacterClassRange":
                            return r.min.raw + "-" + r.max.raw;
                        default:
                            throw new Error("Unhandled range type: " + r.type);
                    }
                }).join("") + "]";
            case "CharacterSet":
                if (elt.kind == "any")
                    return "![\\n]";
                else if (elt.kind == "digit")
                    return (elt.negate ? "!" : "$") + "[0-9]";
                else if (elt.kind == "space")
                    return (elt.negate ? "!" : "$") + "[ \\t\\r\\n]";
                else if (elt.kind == "word")
                    return (elt.negate ? "!" : "$") + "[a-zA-Z0-9_]";
                else
                    new Error("Unhandled range type: EscapeCharacterSet/property");
            case "Character":
                return JSON.stringify(elt.raw);
            default:
                throw new RangeError("Unhandled regexp element type: " + elt.type);
        }
    };
    Context.prototype.defineToken = function (name, content) {
        var _a = takePrec(content), comment = _a.comment, expr = _a.expr;
        if (!comment && name == null && expr.type == "STRING")
            return JSON.stringify(expr.value);
        var newName = name ? this.translateName(name) : this.generateName("token");
        this.tokens[newName] = comment + "{\n    " + this.translateExpr(expr, true) + "\n  }";
        return newName;
    };
    Context.prototype.generateName = function (prefix) {
        for (var i = 1;; i++) {
            var name = prefix + "_" + i;
            if (!(name in this.tokens || name in this.rules))
                return name;
        }
    };
    Context.prototype.build = function () {
        var _this = this;
        if (this.def.word) {
            var expr = this.def.rules[this.def.word], pattern = "";
            for (var _i = 0, _a = expr.type == "SEQ" ? expr.members : [expr]; _i < _a.length; _i++) {
                var part = _a[_i];
                if (part.type == "STRING")
                    pattern += part.value.replace(/[^\w\s]/g, "\\$&");
                else if (part.type == "PATTERN")
                    pattern += part.value;
                else
                    throw new RangeError("Word token too complex");
            }
            this.wordRuleName = this.def.rules["_kw"] ? this.generateName("kw") : "kw";
            this.wordRule = this.wordRuleName + "<term> { @specialize[name={term}]<" + this.translateName(this.def.word) + ", term> }\n\n";
            this.wordRE = new RegExp("^(" + pattern + ")$");
        }
        if (this.def.extras) {
            this.skip = this.def.extras.map(function (e) { return _this.translateExpr(e, false); }).join(" | ");
        }
        else {
            this.tokens["space_1"] = "{ std.whitespace+ }";
            this.skip = "space_1";
        }
        var first = true;
        for (var name in this.def.rules) {
            this.translateRule(name, this.def.rules[name], first);
            first = false;
        }
    };
    Context.prototype.grammar = function () {
        var _this = this;
        var rules = Object.keys(this.rules);
        var ruleStr = rules.map(function (r) { return r + " " + _this.rules[r] + "\n\n"; }).join("");
        var externalStr = this.def.externals && this.def.externals.length
            ? "@external tokens token from \"./tokens\" { " + this.def.externals.map(function (s) { return _this.translateName(s.name); }).join(", ") + " }\n\n"
            : "";
        var tokens = Object.keys(this.tokens);
        var tokenStr = "@tokens {\n" + tokens.map(function (t) { return "  " + t + " " + _this.tokens[t] + "\n"; }).join("") + "}";
        var skipStr = "@skip { " + this.skip + " }\n\n";
        return ruleStr + this.wordRule + skipStr + externalStr + tokenStr;
    };
    return Context;
}());
function importGrammar(content) {
    var def = JSON.parse(content);
    var cx = new Context(def);
    cx.build();
    return cx.grammar();
}
exports.importGrammar = importGrammar;
var test = /^\s*==+\n(.*)\n==+\n\s*([^]+?)\n---+\n\s*([^]+?)(?=\n==+|$)/;
function translateName(name) {
    if (name[0] != "_")
        return name[0].toUpperCase() + name.slice(1).replace(/_\w/g, function (m) { return m.slice(1).toUpperCase(); });
    if (name[1].toUpperCase() != name[1])
        return name[1] + name.slice(2).replace(/_\w/g, function (m) { return m.slice(1).toUpperCase(); });
    return name;
}
function importTest(file, renamed) {
    if (renamed === void 0) { renamed = {}; }
    var result = [], pos = 0;
    while (pos < file.length) {
        var next = test.exec(file.slice(pos));
        if (!next)
            throw new Error("Failing to find test at " + pos);
        var name = next[1], code = next[2], tree = next[3];
        tree = tree
            .replace(/\w+: */g, "")
            .replace(/\((\w+)(\)| *)/g, function (_, n, p) { return n + (p == ")" ? "" : "("); })
            .replace(/(\w|\))(\s+)(\w)/g, function (_, before, space, after) { return before + "," + space + after; })
            .replace(/\w+/g, function (w) {
            return Object.prototype.hasOwnProperty.call(renamed, w) ? renamed[w] : translateName(w);
        });
        result.push("# " + name + "\n\n" + code + "\n==>\n\n" + tree);
        pos += next[0].length;
    }
    return result.join("\n\n");
}
exports.importTest = importTest;
//# sourceMappingURL=import.js.map