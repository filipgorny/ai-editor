import { AppNode } from './AppNode'
import { PackageNode } from './PackageNode'
import { ClassNode } from './ClassNode'
import { FolderNode } from './FolderNode'
import { Component } from './Component'
import { Controller } from './Controller'
import { FunctionNode } from './FunctionNode'
import { Dependency, DependencyKind } from './Dependency'
import { Func } from './Func'
import { Graph } from './Graph'
import { Model } from './Model'
import { Module } from './Module'
import { Node } from './Node'
import { Project } from './Project'
import { Route } from './Route'
import { ScanProgress } from './ScanProgress'
import { Service } from './Service'

// Surowe kształty z @grpc/proto-loader — wyłącznie wewnątrz tej warstwy
// antykorupcyjnej. Reszta aplikacji posługuje się modelem domenowym.
interface RawNode {
  id: string
  kind: string
  name: string
  file: string
  app: string
  functions?: string[]
  route?: string
  appId?: number
  framework?: string
  language?: string
  absFile?: string
}

interface RawEdge {
  from: string
  to: string
  label: string
}

interface RawGraph {
  projectId?: string
  folder?: string
  nodes?: RawNode[]
  edges?: RawEdge[]
}

interface RawProgress {
  message?: string
  currentFile?: string
  filesDone?: number
  entitiesDone?: number
  done?: boolean
  projectId?: string
}

interface RawProject {
  id: string
  folder: string
  gitPath: string
  kind: string
}

// GatewayMapper tłumaczy surowe odpowiedzi gatewaya na model domenowy.
export class GatewayMapper {
  static node(raw: RawNode): Node {
    const funcs = (raw.functions ?? []).map(Func.of)
    const n = GatewayMapper.byKind(raw, funcs)

    n.framework = raw.framework ?? ''
    n.language = raw.language ?? ''
    n.absFile = raw.absFile ?? ''

    return n
  }

  private static byKind(raw: RawNode, funcs: Func[]): Node {
    switch (raw.kind) {
      case 'folder':
        return new FolderNode(raw.id, raw.name, raw.file, raw.app)

      case 'app':
        return new AppNode(raw.id, raw.name, raw.file, raw.app, raw.appId ?? 0)

      case 'package':
        return new PackageNode(raw.id, raw.name, raw.file, raw.app, raw.appId ?? 0)

      case 'component':
        return new Component(raw.id, raw.name, raw.file, raw.app, funcs)

      case 'controller':
        return new Controller(raw.id, raw.name, raw.file, raw.app, funcs, Route.of(raw.route ?? ''))

      case 'service':
        return new Service(raw.id, raw.name, raw.file, raw.app, funcs)

      case 'class':
        return new ClassNode(raw.id, raw.name, raw.file, raw.app, funcs)

      case 'model':
        return new Model(raw.id, raw.name, raw.file, raw.app, funcs)

      case 'function':
        return new FunctionNode(raw.id, raw.name, raw.file, raw.app, funcs)

      default:
        return new Module(raw.id, raw.name, raw.file, raw.app, funcs)
    }
  }

  static dependency(raw: RawEdge): Dependency {
    return new Dependency(raw.from, raw.to, raw.label as DependencyKind)
  }

  static graph(raw: RawGraph): Graph {
    const nodes = (raw.nodes ?? []).map((n) => GatewayMapper.node(n))
    const deps = (raw.edges ?? []).map((e) => GatewayMapper.dependency(e))

    return new Graph(raw.projectId ?? '', raw.folder ?? '', nodes, deps)
  }

  static progress(raw: RawProgress): ScanProgress {
    return new ScanProgress(
      raw.message ?? '',
      raw.currentFile ?? '',
      raw.filesDone ?? 0,
      raw.entitiesDone ?? 0,
      Boolean(raw.done),
      raw.projectId ?? ''
    )
  }

  static projects(raw: { projects?: RawProject[] }): Project[] {
    return (raw.projects ?? []).map((p) => new Project(p.id, p.folder, p.gitPath, p.kind))
  }
}
