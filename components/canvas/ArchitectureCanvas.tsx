"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
  Panel,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { nodeTypes } from "@/components/nodes";
import { ComponentSidebar } from "@/components/sidebar/ComponentSidebar";
import { PropertiesPanel } from "@/components/panels/PropertiesPanel";
import { Toolbar } from "@/components/toolbar/Toolbar";
import { LoadArchitectureModal } from "@/components/modals/LoadArchitectureModal";
import { TerraformViewerModal } from "@/components/modals/TerraformViewerModal";
import { ShareModal } from "@/components/modals/ShareModal";
import type { AwsNodeData, ArchitectureMetadata, TerraformOutput } from "@/types";
import { CANVAS_DEFAULTS, DRAG_DATA_TYPE } from "@/lib/constants";
import { exportCanvasToPng, exportCanvasToPdf, exportToJson, sanitizeFilename } from "@/lib/export";
import { saveArchitecture, listArchitectures, loadArchitecture } from "@/lib/storage";
import { getComponentDefinition } from "@/lib/aws-components";
import { createNodeFromComponent, isAwsComponentType } from "@/lib/utils";
import { ARCHITECTURE_TEMPLATES } from "@/lib/templates";
import { generateTerraform } from "@/lib/terraform";

function ArchitectureCanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const canvasExportRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AwsNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [architectureId, setArchitectureId] = useState<string | null>(null);
  const [architectureName, setArchitectureName] = useState("Untitled Architecture");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [loadModalOpen, setLoadModalOpen] = useState(false);

  // Terraform generation states
  const [tfModalOpen, setTfModalOpen] = useState(false);
  const [generatedTf, setGeneratedTf] = useState<TerraformOutput | null>(null);

  // Cloud sharing states
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [s3Url, setS3Url] = useState<string | null>(null);
  const [isSharingCloud, setIsSharingCloud] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [architectures, setArchitectures] = useState<ArchitectureMetadata[]>([]);

  // Hydration fix: Load saved architectures after mount on the client
  useEffect(() => {
    if (typeof window !== "undefined") {
      setArchitectures(listArchitectures());
    }
  }, []);

  const selectedNodeData =
    nodes.find((n) => n.id === selectedNodeId)?.data ?? null;

  const markDirty = useCallback(() => setHasUnsavedChanges(true), []);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            animated: true,
            style: { stroke: "#ff9900", strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: "#ff9900",
            },
          },
          eds
        )
      );
      markDirty();
    },
    [setEdges, markDirty]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(DRAG_DATA_TYPE);
      if (!isAwsComponentType(type)) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = createNodeFromComponent(type, position);
      setNodes((nds) => [...nds, newNode]);
      markDirty();
    },
    [screenToFlowPosition, setNodes, markDirty]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setPropertiesOpen(true);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const onUpdateNode = useCallback(
    (nodeId: string, data: Partial<AwsNodeData>) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
        )
      );
      markDirty();
    },
    [setNodes, markDirty]
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      markDirty();
    },
    [setNodes, setEdges, markDirty]
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const saved = saveArchitecture(architectureName, nodes, edges, {
        id: architectureId ?? undefined,
      });
      setArchitectureId(saved.id);
      setHasUnsavedChanges(false);
      setArchitectures(listArchitectures());
    } finally {
      setIsSaving(false);
    }
  }, [architectureName, nodes, edges, architectureId]);

  const handleLoad = useCallback((id: string) => {
    const architecture = loadArchitecture(id);
    if (!architecture) return;

    // Map legacy edges to have arrow markers just in case
    const loadedEdges = architecture.edges.map((edge) => ({
      ...edge,
      markerEnd: edge.markerEnd || {
        type: MarkerType.ArrowClosed,
        color: "#ff9900",
      },
    }));

    setNodes(architecture.nodes);
    setEdges(loadedEdges);
    setArchitectureId(architecture.id);
    setArchitectureName(architecture.name);
    setSelectedNodeId(null);
    setHasUnsavedChanges(false);
    setLoadModalOpen(false);
  }, [setNodes, setEdges]);

  const handleNew = useCallback(() => {
    if (
      hasUnsavedChanges &&
      !window.confirm("You have unsaved changes. Create a new architecture anyway?")
    ) {
      return;
    }
    setNodes([]);
    setEdges([]);
    setArchitectureId(null);
    setArchitectureName("Untitled Architecture");
    setSelectedNodeId(null);
    setHasUnsavedChanges(false);
  }, [hasUnsavedChanges, setNodes, setEdges]);

  const handleClear = useCallback(() => {
    if (!window.confirm("Clear all components from the canvas?")) return;
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    markDirty();
  }, [setNodes, setEdges, markDirty]);

  // Project Templates selection loader
  const handleSelectTemplate = useCallback((templateId: string) => {
    if (
      hasUnsavedChanges &&
      !window.confirm("Loading a template will overwrite your active topology canvas. Continue?")
    ) {
      return;
    }
    const template = ARCHITECTURE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    // Deep copy templates definition and inject active arrow markers
    const newNodes = JSON.parse(JSON.stringify(template.nodes)) as Node<AwsNodeData>[];
    const newEdges = (JSON.parse(JSON.stringify(template.edges)) as Edge[]).map((e) => ({
      ...e,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#ff9900",
      },
    }));

    setNodes(newNodes);
    setEdges(newEdges);
    setArchitectureName(template.name);
    setArchitectureId(null); // Fresh project
    setSelectedNodeId(null);
    setHasUnsavedChanges(true);
  }, [hasUnsavedChanges, setNodes, setEdges]);

  // PNG Export
  const handleExportPng = useCallback(async () => {
    const element = canvasExportRef.current;
    if (!element) return;

    try {
      await exportCanvasToPng(element, {
        filename: `${sanitizeFilename(architectureName)}.png`,
        backgroundColor: "#0f1419",
      });
    } catch (error) {
      console.error("Export PNG failed:", error);
      alert("Failed to export PNG. Please try again.");
    }
  }, [architectureName]);

  // PDF Report Export
  const handleExportPdf = useCallback(async () => {
    const element = canvasExportRef.current;
    if (!element) return;

    try {
      await exportCanvasToPdf(element, architectureName, nodes, edges, {
        filename: `${sanitizeFilename(architectureName)}.pdf`,
        backgroundColor: "#0f1419",
      });
    } catch (error) {
      console.error("Export PDF failed:", error);
      alert("Failed to generate PDF report. Check your browser parameters.");
    }
  }, [architectureName, nodes, edges]);

  // JSON Configuration Configuration Export
  const handleExportJson = useCallback(() => {
    try {
      exportToJson(architectureName, nodes, edges);
    } catch (error) {
      console.error("Export JSON failed:", error);
      alert("Failed to export configuration JSON.");
    }
  }, [architectureName, nodes, edges]);

  // JSON Import reader
  const handleImportJson = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data.nodes || !data.edges) {
          throw new Error("Invalid structure metadata.");
        }

        // Apply arrow markers to imported connections
        const updatedEdges = (data.edges as Edge[]).map((edge) => ({
          ...edge,
          markerEnd: edge.markerEnd || {
            type: MarkerType.ArrowClosed,
            color: "#ff9900",
          },
        }));

        setNodes(data.nodes);
        setEdges(updatedEdges);
        setArchitectureName(data.name || "Imported Project");
        setArchitectureId(null);
        setSelectedNodeId(null);
        setHasUnsavedChanges(true);

        alert("Project configuration imported successfully!");
      } catch (err) {
        console.error("JSON parsing error: ", err);
        alert("Failed to import JSON file. Please ensure it is a valid cloud architecture blueprint.");
      }
    };
    reader.readAsText(file);

    // Clear input value so same file can be imported again if needed
    event.target.value = "";
  }, [setNodes, setEdges]);

  // Terraform Code Generator
  const handleGenerateTerraform = useCallback(() => {
    try {
      const output = generateTerraform(architectureId || "project-cloud-design", nodes, edges);
      setGeneratedTf(output);
      setTfModalOpen(true);
    } catch (err) {
      console.error("Terraform generation error: ", err);
      alert("Failed to generate HCL configurations.");
    }
  }, [architectureId, nodes, edges]);

  // S3 Cloud Upload Trigger Handler
  const handleShareCloud = useCallback(async () => {
    const element = canvasExportRef.current;
    if (!element) return;

    setIsSharingCloud(true);
    try {
      // 1. Snapshot PNG from react flow canvas
      const dataUrl = await toPng(element, {
        backgroundColor: "#0f1419",
        quality: 0.95,
        pixelRatio: 1.5,
        filter: (node) => {
          if (node instanceof HTMLElement) {
            return !node.classList.contains("no-export");
          }
          return true;
        },
      });

      setPreviewImage(dataUrl);

      // 2. Post payload to API Endpoint
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: dataUrl,
          filename: sanitizeFilename(architectureName),
        }),
      });

      const responseBody = await response.json();

      if (!response.ok) {
        throw new Error(responseBody.error || "Failed uploading asset to backend S3 API.");
      }

      setS3Url(responseBody.url);
      setShareModalOpen(true);
    } catch (err: unknown) {
      console.error("Cloud share error: ", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      alert(
        errMsg || "Failed to upload diagram to AWS Cloud. Verify your environment keys are active."
      );
    } finally {
      setIsSharingCloud(false);
    }
  }, [architectureName]);

  const openLoadModal = useCallback(() => {
    setArchitectures(listArchitectures());
    setLoadModalOpen(true);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d1117]">
      <Toolbar
        architectureName={architectureName}
        onNameChange={(name) => {
          setArchitectureName(name);
          markDirty();
        }}
        onSave={handleSave}
        onLoad={openLoadModal}
        onExportPng={handleExportPng}
        onExportPdf={handleExportPdf}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onGenerateTerraform={handleGenerateTerraform}
        onShare={handleShareCloud}
        onNew={handleNew}
        onClear={handleClear}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
        isSaving={isSaving}
        isSharingCloud={isSharingCloud}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      <div className="flex min-h-0 flex-1">
        <ComponentSidebar
          collapsed={!sidebarOpen}
          onToggle={() => setSidebarOpen(false)}
          onSelectTemplate={handleSelectTemplate}
        />

        <div ref={canvasExportRef} className="relative min-w-0 flex-1">
          <div ref={reactFlowWrapper} className="h-full w-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                if (changes.some((c) => c.type === "position" || c.type === "remove")) {
                  markDirty();
                }
              }}
              onEdgesChange={(changes) => {
                onEdgesChange(changes);
                if (changes.length > 0) markDirty();
              }}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              snapToGrid
              snapGrid={CANVAS_DEFAULTS.snapGrid}
              minZoom={CANVAS_DEFAULTS.minZoom}
              maxZoom={CANVAS_DEFAULTS.maxZoom}
              defaultEdgeOptions={{
                type: "smoothstep",
                animated: true,
                style: { stroke: "#ff9900", strokeWidth: 2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: "#ff9900",
                },
              }}
              proOptions={{ hideAttribution: true }}
              className="bg-[#0f1419]"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={CANVAS_DEFAULTS.backgroundGap}
                size={CANVAS_DEFAULTS.backgroundSize}
                color="#21262d"
              />
              <Controls
                className="!rounded-lg !border !border-[#30363d] !bg-[#161b22] !shadow-lg [&>button]:!border-[#30363d] [&>button]:!bg-[#21262d] [&>button]:!text-[#c9d1d9] [&>button:hover]:!bg-[#30363d]"
              />
              <MiniMap
                className="!rounded-lg !border !border-[#30363d] !bg-[#161b22]"
                nodeColor={(node) => {
                  const def = getComponentDefinition(
                    (node.data as AwsNodeData).componentType
                  );
                  return def?.color ?? "#ff9900";
                }}
                maskColor="rgba(13, 17, 23, 0.8)"
              />
              {nodes.length === 0 && (
                <Panel position="top-center" className="no-export mt-16">
                  <div className="rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/90 px-8 py-6 text-center backdrop-blur-sm">
                    <p className="text-sm font-medium text-[#f0f6fc]">
                      Drag AWS components here to start designing
                    </p>
                    <p className="mt-1 text-xs text-[#8b949e]">
                      Connect services with arrows to visualize data flow
                    </p>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </div>
        </div>

        <PropertiesPanel
          nodeId={selectedNodeId}
          nodeData={selectedNodeData}
          onUpdate={onUpdateNode}
          onDelete={onDeleteNode}
          collapsed={!propertiesOpen}
          nodes={nodes}
          edges={edges}
        />
      </div>

      <LoadArchitectureModal
        open={loadModalOpen}
        architectures={architectures}
        onClose={() => setLoadModalOpen(false)}
        onLoad={handleLoad}
        onRefresh={() => setArchitectures(listArchitectures())}
      />

      <TerraformViewerModal
        open={tfModalOpen}
        onClose={() => setTfModalOpen(false)}
        terraform={generatedTf}
        architectureName={architectureName}
      />

      <ShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        s3Url={s3Url}
        architectureName={architectureName}
        previewImage={previewImage}
      />
    </div>
  );
}

export function ArchitectureCanvas() {
  return (
    <ReactFlowProvider>
      <ArchitectureCanvasInner />
    </ReactFlowProvider>
  );
}
