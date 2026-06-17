import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import type { Edge, Node } from "@xyflow/react";
import type { AwsNodeData, ExportOptions } from "@/types";
import { estimateCost } from "./cost-estimation";
import { validateArchitecture } from "./validation";

export async function exportCanvasToPng(
  element: HTMLElement,
  options: ExportOptions = {}
): Promise<void> {
  const {
    filename = `architecture-${new Date().toISOString().slice(0, 10)}.png`,
    backgroundColor = "#0f1419",
    quality = 1,
  } = options;

  const dataUrl = await toPng(element, {
    backgroundColor,
    quality,
    pixelRatio: 2,
    filter: (node) => {
      if (node instanceof HTMLElement) {
        return !node.classList.contains("no-export");
      }
      return true;
    },
  });

  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export async function exportCanvasToPdf(
  element: HTMLElement,
  architectureName: string,
  nodes: Node<AwsNodeData>[],
  edges: Edge[],
  options: ExportOptions = {}
): Promise<void> {
  const {
    filename = `${sanitizeFilename(architectureName)}.pdf`,
    backgroundColor = "#0f1419",
  } = options;

  // 1. Capture the canvas as PNG screenshot
  const dataUrl = await toPng(element, {
    backgroundColor,
    quality: 0.95,
    pixelRatio: 1.5,
    filter: (node) => {
      if (node instanceof HTMLElement) {
        return !node.classList.contains("no-export");
      }
      return true;
    },
  });

  // 2. Create jsPDF in A4 portrait
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  pdf.setFont("helvetica");

  // Cover Header block
  pdf.setFillColor(13, 17, 23);
  pdf.rect(0, 0, pageWidth, 40, "F");

  // Title
  pdf.setTextColor(255, 153, 0); // AWS Orange
  pdf.setFontSize(20);
  pdf.text("AWS Cloud Architecture Report", 15, 16);

  // Subtitle
  pdf.setTextColor(201, 209, 217);
  pdf.setFontSize(13);
  pdf.text(architectureName || "Untitled Architecture", 15, 25);

  // Metadata
  pdf.setTextColor(139, 148, 158);
  pdf.setFontSize(9);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, 15, 33);

  // Health Score Block
  const health = validateArchitecture(nodes, edges);
  pdf.setFillColor(22, 27, 34);
  pdf.roundedRect(15, 48, 85, 24, 2, 2, "F");

  pdf.setTextColor(139, 148, 158);
  pdf.setFontSize(9);
  pdf.text("ARCHITECTURE HEALTH SCORE", 20, 54);

  if (health.healthScore >= 80) {
    pdf.setTextColor(46, 160, 67); // Green
  } else if (health.healthScore >= 50) {
    pdf.setTextColor(210, 153, 34); // Amber
  } else {
    pdf.setTextColor(248, 81, 73); // Red
  }
  pdf.setFontSize(16);
  pdf.text(`${health.healthScore} / 100`, 20, 64);

  // Cost Estimation Block
  const costInput = {
    architectureId: "report-estimate",
    nodes,
    region: nodes[0]?.data.region ?? "us-east-1",
  };
  const cost = estimateCost(costInput);

  pdf.setFillColor(22, 27, 34);
  pdf.roundedRect(110, 48, 85, 24, 2, 2, "F");

  pdf.setTextColor(139, 148, 158);
  pdf.setFontSize(9);
  pdf.text("ESTIMATED MONTHLY COST", 115, 54);

  pdf.setTextColor(255, 153, 0);
  pdf.setFontSize(16);
  pdf.text(`$${cost.totalMonthlyUsd.toFixed(2)} USD`, 115, 64);

  // Image block header
  pdf.setTextColor(13, 17, 23);
  pdf.setFontSize(11);
  pdf.text("Architecture Design Canvas Topology", 15, 82);

  // Add the diagram image
  const imgWidth = 180;
  const imgHeight = 95;
  pdf.setFillColor(15, 20, 25);
  pdf.rect(15, 86, imgWidth, imgHeight, "F");
  pdf.addImage(dataUrl, "PNG", 15, 86, imgWidth, imgHeight);

  // Cost breakdown
  pdf.setTextColor(13, 17, 23);
  pdf.setFontSize(11);
  pdf.text("Resources Billing Breakdown (Real-time Model)", 15, 192);

  // Draw simple table headers
  let yPos = 199;
  pdf.setFontSize(8);
  pdf.setTextColor(100, 100, 100);
  pdf.text("AWS COMPONENT", 20, yPos);
  pdf.text("QTY", 100, yPos);
  pdf.text("UNIT COST", 125, yPos);
  pdf.text("TOTAL MONTHLY", 160, yPos);

  pdf.line(15, yPos + 1.5, 195, yPos + 1.5);
  yPos += 6;

  // Aggregate items
  const counts: Record<string, number> = {};
  const sumCosts: Record<string, number> = {};
  const componentLabels: Record<string, string> = {
    ec2: "Amazon EC2 Compute Instance",
    rds: "Amazon RDS Relational Database",
    s3: "Amazon S3 Simple Storage Service",
    lambda: "AWS Lambda Serverless Function",
    "load-balancer": "Elastic Load Balancing (ALB)",
    cloudfront: "Amazon CloudFront CDN Distribution",
  };

  cost.lineItems.forEach((item) => {
    counts[item.componentType] = (counts[item.componentType] || 0) + 1;
    sumCosts[item.componentType] = (sumCosts[item.componentType] || 0) + item.monthlyCostUsd;
  });

  pdf.setTextColor(50, 50, 50);
  pdf.setFontSize(8.5);
  Object.entries(counts).forEach(([compType, qty]) => {
    const label = componentLabels[compType] || compType.toUpperCase();
    const rate = sumCosts[compType] / qty;
    const total = sumCosts[compType];

    pdf.text(label, 20, yPos);
    pdf.text(qty.toString(), 102, yPos);
    pdf.text(`$${rate.toFixed(2)}`, 126, yPos);
    pdf.text(`$${total.toFixed(2)}`, 162, yPos);

    yPos += 5.5;
  });

  // Add Page 2 for warnings and compliance details if warnings are active
  if (health.warnings.length > 0) {
    pdf.addPage();
    pdf.setFillColor(13, 17, 23);
    pdf.rect(0, 0, pageWidth, 25, "F");

    pdf.setTextColor(255, 153, 0);
    pdf.setFontSize(13);
    pdf.text("Architecture Validation Warnings & Warnings Summary", 15, 15);

    let listY = 38;
    pdf.setTextColor(248, 81, 73);
    pdf.setFontSize(11);
    pdf.text(`Identified Architecture Issues (${health.warnings.length})`, 15, listY);
    listY += 6;

    health.warnings.forEach((warn, idx) => {
      if (listY > pageHeight - 35) {
        pdf.addPage();
        listY = 20;
      }

      pdf.setFillColor(253, 244, 245); // subtle red box
      pdf.roundedRect(15, listY, 180, 24, 1.5, 1.5, "F");

      pdf.setTextColor(153, 27, 27);
      pdf.setFontSize(8.5);
      pdf.setFont("helvetica", "bold");
      pdf.text(`[${warn.type.toUpperCase()}] ${warn.message}`, 20, listY + 5.5);

      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(71, 85, 105);
      pdf.text(`Compliance Rule: ${warn.rule}`, 20, listY + 11);

      const matchRec = health.recommendations[idx];
      if (matchRec) {
        pdf.setTextColor(30, 41, 59);
        pdf.text(`Remediation: ${matchRec.message} -> ${matchRec.action}`, 20, listY + 16.5);
      }

      listY += 28;
    });
  }

  // 3. Save PDF file
  pdf.save(filename);
}

export function exportToJson(
  architectureName: string,
  nodes: Node<AwsNodeData>[],
  edges: Edge[]
): void {
  const data = {
    name: architectureName,
    nodes,
    edges,
    version: 1,
    exportedAt: new Date().toISOString(),
  };

  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(architectureName)}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase() || "architecture";
}
