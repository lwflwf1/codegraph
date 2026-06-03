import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText } from '../tree-sitter-helpers';
import type { LanguageExtractor, VariableInfo } from '../tree-sitter-types';

function findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) return child;
  }
  return null;
}

function findChildOfAnyKind(node: SyntaxNode, type: string): SyntaxNode | null {
  const count = (node as any).childCount ?? node.namedChildCount;
  for (let i = 0; i < count; i++) {
    const child = (node as any).child(i);
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

function extractVariablesImpl(node: SyntaxNode, source: string): VariableInfo[] {
  const type = node.type;
  const infos: VariableInfo[] = [];

  if (type === 'data_declaration') {
    const varList = findChildByType(node, 'list_of_variable_decl_assignments');
    if (!varList) return [];
    const isConst = findChildOfAnyKind(node, 'const') !== null;
    for (let i = 0; i < varList.namedChildCount; i++) {
      const decl = varList.namedChild(i);
      if (decl && decl.type === 'variable_decl_assignment') {
        const nameNode = decl.childForFieldName('name');
        if (nameNode) {
          infos.push({
            name: getNodeText(nameNode, source),
            kind: isConst ? 'constant' : 'variable',
            positionNode: nameNode,
          });
        }
      }
    }
    return infos;
  }

  if (type === 'net_declaration') {
    const netList = findChildByType(node, 'list_of_net_decl_assignments');
    if (!netList) return [];
    for (let i = 0; i < netList.namedChildCount; i++) {
      const decl = netList.namedChild(i);
      if (decl && decl.type === 'net_decl_assignment') {
        for (let j = 0; j < decl.namedChildCount; j++) {
          const c = decl.namedChild(j);
          if (c && c.type === 'simple_identifier') {
            infos.push({ name: getNodeText(c, source), kind: 'variable', positionNode: c });
            break;
          }
        }
      }
    }
    return infos;
  }

  if (type === 'parameter_declaration' || type === 'local_parameter_declaration') {
    const paramList = findChildByType(node, 'list_of_param_assignments');
    if (!paramList) return [];
    for (let i = 0; i < paramList.namedChildCount; i++) {
      const pa = paramList.namedChild(i);
      if (pa && pa.type === 'param_assignment') {
        for (let j = 0; j < pa.namedChildCount; j++) {
          const c = pa.namedChild(j);
          if (c && (c.type === 'parameter_identifier' || c.type === 'simple_identifier')) {
            infos.push({ name: getNodeText(c, source), kind: 'constant', positionNode: c });
            break;
          }
        }
      }
    }
    return infos;
  }

  if (type === 'ansi_port_declaration') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.type === 'simple_identifier') {
        infos.push({ name: getNodeText(c, source), kind: 'variable', positionNode: c });
        break;
      }
    }
    return infos;
  }

  return [];
}

function extractCalleeName(node: SyntaxNode, source: string): string | undefined {
  const tfCall = node.namedChild(0);
  if (!tfCall || tfCall.type !== 'tf_call') return undefined;
  const hierId = tfCall.namedChild(0);
  if (!hierId || hierId.type !== 'hierarchical_identifier') return undefined;
  const parts: string[] = [];
  for (let i = 0; i < hierId.namedChildCount; i++) {
    const c = hierId.namedChild(i);
    if (c && c.type === 'simple_identifier') {
      parts.push(getNodeText(c, source));
    }
  }
  return parts.length > 0 ? parts.join('.') : undefined;
}

export const systemverilogExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration', 'task_declaration', 'class_constructor_declaration'],
  classTypes: ['module_declaration', 'class_declaration', 'package_declaration', 'covergroup_declaration'],
  methodTypes: [],
  interfaceTypes: ['interface_declaration'],
  structTypes: [],
  enumTypes: [],
  enumMemberTypes: [],
  typeAliasTypes: ['type_declaration'],
  importTypes: ['package_import_declaration', 'dpi_import_export'],
  callTypes: ['module_instantiation', 'interface_instantiation', 'program_instantiation', 'checker_instantiation'],
  variableTypes: [],
  constraintTypes: ['constraint_declaration'],
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
    if (node.type === 'class_constructor_declaration') {
      return 'new';
    }
    if (node.type === 'constraint_declaration') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c && c.type === 'simple_identifier') return getNodeText(c, source);
      }
      return undefined;
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
    if (node.type === 'module_declaration') {
      return node;
    }
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
    const standard = node.childForFieldName('body');
    if (standard) return standard;
    return null;
  },
  visitNode: (node, ctx) => {
    const varTypes = [
      'data_declaration', 'net_declaration',
      'parameter_declaration', 'local_parameter_declaration',
      'ansi_port_declaration',
    ];

    if (varTypes.includes(node.type)) {
      for (let i = ctx.nodeStack.length - 1; i >= 0; i--) {
        const id = ctx.nodeStack[i];
        const n = ctx.nodes.find(n => n.id === id);
        if (n && (n.kind === 'function' || n.kind === 'method')) return false;
      }
      const variables = extractVariablesImpl(node, ctx.source);
      for (const v of variables) {
        ctx.createNode(v.kind, v.name, v.positionNode || node, {});
      }
      return variables.length > 0;
    }

    if (node.type === 'subroutine_call' && ctx.nodeStack.length > 0) {
      const calleeName = extractCalleeName(node, ctx.source);
      if (calleeName) {
        const callerId = ctx.nodeStack[ctx.nodeStack.length - 1];
        if (callerId) {
          ctx.addUnresolvedReference({
            fromNodeId: callerId,
            referenceName: calleeName,
            referenceKind: 'calls',
            line: node.startPosition.row + 1,
            column: node.startPosition.column,
          });
        }
      }
      return false;
    }

    return false;
  },
  getVisibility: (node) => {
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
      if (cur.type === 'class_item_qualifier' || cur.type === 'method_qualifier') {
        for (let i = 0; i < cur.childCount; i++) {
          const c = cur.child(i);
          if (c && !c.isNamed) {
            if (c.type === 'local') return 'private';
            if (c.type === 'protected') return 'protected';
          }
        }
        return undefined;
      }
      cur = cur.parent;
    }
    return undefined;
  },
  isConst: (node) => {
    return node.type === 'parameter_declaration' || node.type === 'local_parameter_declaration';
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
