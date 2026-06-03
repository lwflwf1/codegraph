import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';

function findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) return child;
  }
  return null;
}

function getNameFromHeaderChild(node: SyntaxNode, source: string): string | undefined {
  const headerTypes = [
    'module_ansi_header', 'module_nonansi_header',
    'interface_ansi_header', 'interface_nonansi_header',
    'program_ansi_header', 'program_nonansi_header',
  ];
  for (const hType of headerTypes) {
    const header = findChildByType(node, hType);
    if (header) {
      const nameNode = header.childForFieldName('name');
      if (nameNode) return getNodeText(nameNode, source);
    }
  }
  return undefined;
}

function getNameFromBodyDecl(node: SyntaxNode, source: string): string | undefined {
  const bodyTypes = ['function_body_declaration', 'task_body_declaration'];
  for (const bType of bodyTypes) {
    const body = findChildByType(node, bType);
    if (body) {
      const nameNode = body.childForFieldName('name');
      if (nameNode) return getNodeText(nameNode, source);
    }
  }
  return undefined;
}

export const systemverilogExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration', 'task_declaration'],
  classTypes: ['module_declaration', 'class_declaration', 'package_declaration', 'covergroup_declaration'],
  methodTypes: [],
  interfaceTypes: ['interface_declaration'],
  structTypes: [],
  enumTypes: [],
  enumMemberTypes: [],
  typeAliasTypes: ['type_declaration'],
  importTypes: ['package_import_declaration', 'dpi_import_export'],
  callTypes: ['module_instantiation', 'interface_instantiation', 'program_instantiation', 'method_call', 'checker_instantiation'],
  variableTypes: [],
  extraClassNodeTypes: ['checker_declaration', 'program_declaration', 'interface_class_declaration'],
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',
  resolveName: (node, source) => {
    if (node.type === 'module_declaration' ||
        node.type === 'interface_declaration' ||
        node.type === 'program_declaration') {
      return getNameFromHeaderChild(node, source);
    }
    if (node.type === 'function_declaration' ||
        node.type === 'task_declaration') {
      return getNameFromBodyDecl(node, source);
    }
    if (node.type === 'module_instantiation' ||
        node.type === 'interface_instantiation' ||
        node.type === 'program_instantiation' ||
        node.type === 'checker_instantiation') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === 'simple_identifier') {
          return getNodeText(child, source);
        }
      }
      return undefined;
    }
    if (node.type === 'method_call') {
      const body = findChildByType(node, 'method_call_body');
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const child = body.namedChild(i);
          if (child && child.type === 'simple_identifier') {
            return getNodeText(child, source);
          }
        }
      }
      return undefined;
    }
    if (node.type === 'class_declaration' ||
        node.type === 'package_declaration' ||
        node.type === 'checker_declaration' ||
        node.type === 'interface_class_declaration' ||
        node.type === 'covergroup_declaration') {
      const n = node.childForFieldName('name');
      if (n) return getNodeText(n, source);
      return undefined;
    }
    return undefined;
  },
  resolveBody: (node, _bodyField) => {
    if (node.type === 'function_declaration') {
      const body = findChildByType(node, 'function_body_declaration');
      if (body) {
        const stmtBlock = findChildByType(body, 'statement_or_null');
        if (stmtBlock) return stmtBlock;
      }
      return null;
    }
    if (node.type === 'task_declaration') {
      const body = findChildByType(node, 'task_body_declaration');
      if (body) {
        const stmtBlock = findChildByType(body, 'statement_or_null');
        if (stmtBlock) return stmtBlock;
      }
      return null;
    }
    if (node.type === 'module_declaration') {
      const ansi = findChildByType(node, 'module_ansi_header');
      if (ansi) return ansi.nextNamedSibling || null;
      const nonansi = findChildByType(node, 'module_nonansi_header');
      if (nonansi) return nonansi.nextNamedSibling || null;
      return null;
    }
    const standard = node.childForFieldName('body');
    if (standard) return standard;
    return null;
  },
  extractImport: (node, source) => {
    const importText = source.substring(node.startIndex, node.endIndex).trim();

    if (node.type === 'package_import_declaration') {
      const importItem = findChildByType(node, 'package_import_item');
      if (importItem) {
        for (let i = 0; i < importItem.namedChildCount; i++) {
          const child = importItem.namedChild(i);
          if (child && child.type === 'simple_identifier') {
            return { moduleName: getNodeText(child, source), signature: importText };
          }
        }
      }
      return { moduleName: importText, signature: importText };
    }

    if (node.type === 'dpi_import_export') {
      const dpiFunc = findChildByType(node, 'dpi_function_proto');
      if (dpiFunc) {
        const nameNode = dpiFunc.childForFieldName('name');
        if (nameNode) {
          return { moduleName: 'DPI-C', signature: importText };
        }
      }
      const dpiTask = findChildByType(node, 'dpi_task_proto');
      if (dpiTask) {
        const nameNode = dpiTask.childForFieldName('name');
        if (nameNode) {
          return { moduleName: 'DPI-C', signature: importText };
        }
      }
      return { moduleName: 'DPI-C', signature: importText };
    }

    return null;
  },
};
