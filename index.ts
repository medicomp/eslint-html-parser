import { AST, SourceCode } from 'eslint';
import * as path from 'path';
import { ScopeManager, Scope } from 'eslint-scope';
import { Parser, Handler } from 'htmlparser2';
import { HTMLElement, HTMLAttribute, HTMLText, ESLintHTMLParserToken, HTMLWhitespace } from './elements';
import { ESLintHtmlParseResult, HTMLSyntaxTree } from './parsing';

// TODO: config option
const htmlExtensions: string[] = ['.htm', '.html'];
const startsWithHtmlTag: RegExp = /^\s*</;

const visitorKeys: SourceCode.VisitorKeys = {
    "Program": ["root"],
    "HTMLAttribute": ["attributeName", "attributeValue"],
    "HTMLAttributeName": [],
    "HTMLAttributeValue": [],
    "HTMLElement": ["children"],
    "HTMLText": [],
    "HTMLWhitespace": []
};

function isHtmlFile(code: string, options: any): boolean {
    const filePath: string = (options.filePath as string | undefined) || "unknown.js";
    return htmlExtensions.indexOf(path.extname(filePath)) != -1 || startsWithHtmlTag.test(code);
}

export function parseForESLint(code: string, options: any): ESLintHtmlParseResult {
    if (!isHtmlFile(code, options)) {
        // TODO: config option
        let fallbackParser: any = require('espree');

        if (typeof fallbackParser.parseForESLint == 'function') {
            return fallbackParser.parseForESLint(code, options);
        }

        else {
            return {
                ast: fallbackParser.parse(code, options)
            };
        }
    }

    let lineBreakIndices: number[] = [-1];
    let currentIndex = code.indexOf('\n');

    while (currentIndex != -1) {
        lineBreakIndices.push(currentIndex);
        currentIndex = code.indexOf('\n', currentIndex + 1);
    }

    let tabIndices: number[] = [];
    currentIndex = code.indexOf('\t');

    while (currentIndex != -1) {
        tabIndices.push(currentIndex);
        currentIndex = code.indexOf('\t', currentIndex + 1);
    }

    function getLineAndColumn(index: number) {
        let lineNumber: number = 0;
        
        for (; lineNumber < lineBreakIndices.length; lineNumber++) {
            if (index < lineBreakIndices[lineNumber]) {
                break;
            }
        }

        let column: number = index - lineBreakIndices[lineNumber - 1] - 1;
        let tabNumber: number = -1;

        while (++tabNumber < tabIndices.length) {
            if (tabIndices[tabNumber] < lineBreakIndices[lineNumber - 1]) {
                continue;
            }

            if (tabIndices[tabNumber] < index) {
                column += 4;
            }

            else {
                break;
            }
        }

        return {
            line: lineNumber,
            column: column
        };
    }

    let tokens: ESLintHTMLParserToken[] = [];
    let root: HTMLElement = null;
    let currentElement: HTMLElement = null;
    let currentAttribute: HTMLAttribute = null;

    let onattribdata: (value: string) => void = (value: string) => {
        let startIndex: number = htmlParser._tokenizer._sectionStart;

        currentAttribute.attributeValue = {
            type: 'HTMLAttributeValue',
            value: value,
            parent: currentAttribute,
            range: [startIndex, startIndex + value.length],
            loc: {
                start: getLineAndColumn(startIndex),
                end: getLineAndColumn(startIndex + value.length)
            }
        };

        currentAttribute.range[1] = startIndex + value.length + 1;
        currentAttribute.value = code.substr(currentAttribute.range[0], currentAttribute.range[1] - currentAttribute.range[0])
        currentAttribute.loc.end = getLineAndColumn(currentAttribute.range[1]);

        tokens.push(currentAttribute.attributeValue);
    }

    let onattribname: (name: string) => void = (name: string) => {
        let attribute: HTMLAttribute = {
            type: 'HTMLAttribute',
            range: [htmlParser._tokenizer._sectionStart, -1],
            parent: currentElement,
            attributeName: null,
            attributeValue: null,
            value: null,
            loc: {
                start: getLineAndColumn(htmlParser._tokenizer._sectionStart),
                end: null
            }
        };

        attribute.attributeName = {
            type: 'HTMLAttributeName',
            value: name,
            parent: attribute,
            range: [attribute.range[0], attribute.range[0] + name.length],
            loc: {
                start: getLineAndColumn(attribute.range[0]),
                end: getLineAndColumn(attribute.range[0] + name.length)
            }
        };

        currentAttribute = attribute;

        if (!currentElement.attributes) {
            currentElement.attributes = [];
        }

        currentElement.attributes.push(attribute);

        tokens.push(attribute);
        tokens.push(attribute.attributeName);
    };

    let parseHandler: Handler = {
        onopentagend: () => {
            currentElement.range = [htmlParser.startIndex, -1];
            currentElement.loc = {
                start: getLineAndColumn(htmlParser.startIndex),
                end: null
            };
        },

        onopentagname: (name: string) => {
            let element: HTMLElement = {
                comments: [],
                type: 'HTMLElement',
                tagName: name,
                parent: currentElement,
                value: null,
                range: [-1, -1],
                loc: null
            };

            if (!root) {
                root = element;
            }

            if (currentElement) {
                if (!currentElement.children) {
                    currentElement.children = [];
                }

                currentElement.children.push(element);
            }

            currentElement = element;
            tokens.push(element);
        },

        onclosetag: () => {
            currentElement.range[1] = htmlParser.endIndex + 1;
            currentElement.loc.end = getLineAndColumn(htmlParser.endIndex + 1);
            currentElement.value = code.substr(currentElement.range[0], currentElement.range[1] - currentElement.range[0]);

            currentElement = currentElement.parent;
        },

        ontext: (text: string) => {
            let leadingWhitespace: string = (text.match(/^\s+/) || [''])[0];
            let trailingWhitespace: string = leadingWhitespace.length == text.length ? '' : (text.match(/\s+$/) || [''])[0];
            let actualText: string = leadingWhitespace.length == text.length ? '' : text.substr(leadingWhitespace.length, text.length - leadingWhitespace.length - trailingWhitespace.length);

            if (leadingWhitespace) {
                let leadingWhitespaceToken: HTMLWhitespace = {
                    type: 'HTMLWhitespace',
                    parent: currentElement,
                    value: leadingWhitespace,
                    range: [htmlParser.startIndex, htmlParser.startIndex + leadingWhitespace.length],
                    loc: {
                        start: getLineAndColumn(htmlParser.startIndex),
                        end: getLineAndColumn(htmlParser.startIndex + leadingWhitespace.length)
                    }
                }

                if (currentElement) {
                    if (!currentElement.children) {
                        currentElement.children = [];
                    }

                    currentElement.children.push(leadingWhitespaceToken);
                }

                tokens.push(leadingWhitespaceToken);
            }

            if (actualText) {
                let htmlText: HTMLText = {
                    type: 'HTMLText',
                    parent: currentElement,
                    value: actualText,
                    range: [htmlParser.startIndex + leadingWhitespace.length, htmlParser.startIndex + leadingWhitespace.length + actualText.length],
                    loc: {
                        start: getLineAndColumn(htmlParser.startIndex + leadingWhitespace.length),
                        end: getLineAndColumn(htmlParser.startIndex + leadingWhitespace.length + actualText.length)
                    }
                };

                if (currentElement) {
                    if (!currentElement.children) {
                        currentElement.children = [];
                    }

                    currentElement.children.push(htmlText);
                }

                tokens.push(htmlText);
            }

            if (trailingWhitespace) {
                let trailingWhitespaceToken: HTMLWhitespace = {
                    type: 'HTMLWhitespace',
                    parent: currentElement,
                    value: trailingWhitespace,
                    range: [htmlParser.startIndex + leadingWhitespace.length + actualText.length, htmlParser.endIndex],
                    loc: {
                        start: getLineAndColumn(htmlParser.startIndex + leadingWhitespace.length + actualText.length),
                        end: getLineAndColumn(htmlParser.endIndex)
                    }
                }

                if (currentElement) {
                    if (!currentElement.children) {
                        currentElement.children = [];
                    }

                    currentElement.children.push(trailingWhitespaceToken);
                }

                tokens.push(trailingWhitespaceToken);
            }
        }
    }
    
    let htmlParser: Parser = new Parser(parseHandler);

    let originalOnattribname: Function = htmlParser.onattribname;
    htmlParser.onattribname = function (name) {
        originalOnattribname.apply(this, arguments);
        onattribname(name);
    };

    let originalOnattribdata: Function = htmlParser.onattribdata;
    htmlParser.onattribdata = function (value) {
        originalOnattribdata.apply(this, arguments);
        onattribdata(value);
    };

    htmlParser.parseComplete(code);

    let syntaxTree: HTMLSyntaxTree = {
        type: 'Program',
        comments: [],
        tokens: tokens,
        root: root,
        loc: root.loc,
        range: root.range,
        value: code.substr(root.range[0], root.range[1] - root.range[0])
    };

    let scopeManager: ScopeManager = new ScopeManager({});
    let globalScope: Scope = new Scope(scopeManager, 'module', null, syntaxTree, false);

    let result: ESLintHtmlParseResult = {
        ast: syntaxTree,
        visitorKeys: visitorKeys,
        scopeManager: scopeManager,
        services: {}
    };

    return result;
}

export function parse(code: string, options: any): HTMLSyntaxTree | AST.Program {
    return parseForESLint(code, options).ast;
}