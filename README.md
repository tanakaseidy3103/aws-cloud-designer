# AWS Cloud Architecture Platform Designer

A production-ready web application to design, validate, cost-estimate, and export AWS cloud architectures. Built with **Next.js 15**, **TypeScript**, **React Flow**, and **AWS SDK v3**.

![Platform Screenshot](public/aws.png)

👉 **Live Demo:** *[Paste your Vercel deploy link here]*

[![Bilingual / Multi-language](https://img.shields.io/badge/Language-English%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E-blue.svg)](#🇯🇵-日本語-japanese)

---

## 🗺️ Navigation / ナビゲーション

- 🇯🇵 **[日本語のドキュメント (Japanese)](#🇯🇵-日本語-japanese)**
  - [🏆 メインプロジェクトの紹介](#🏆-ポートフォリオの代表作メインプロジェクト)
  - [💡 プロジェクトの目的と解決する課題](#-プロジェクトの目的と解決する課題-objective--problem-solved)
  - [🛠️ 担当した開発範囲と技術的な工夫・こだわり](#️-担当した開発範囲と技術的な工夫こだわり-my-role--engineering-highlights)
  - [🚀 主な機能](#-主な機能)
- 🇬🇧 **[English Documentation (英語)](#🇬🇧-english-英語)**
  - [🏆 Portfolio Centerpiece / Primary Project](#🏆-portfolio-centerpiece--primary-project)
  - [💡 Objective & Problem Solved](#-objective--problem-solved)
  - [🛠️ Scope of Work & Engineering Highlights](#️-scope-of-work--engineering-highlights-my-contribution)
  - [🚀 Key Features](#-key-features)
- ⚙️ **[Setup & Deployment / 設定とデプロイ](#️-setup--deployment)**
  - [Environment Configuration](#1-environment-configuration)
  - [Local Execution](#2-local-run)
  - [Vercel Deployment](#3-vercel-deployment)

---

## 🇯🇵 日本語 (Japanese)

### 🏆 ポートフォリオの代表作（メインプロジェクト）
このリポジトリは、私が**最も多くの時間と開発リソースを投資し、設計から実装までを一貫して担当した中心的なプロジェクト**です。
AWSを初めて学ぶエンジニアから、日常的にクラウド環境を設計するインフラアーキテクトまで、誰もがブラウザ上で直感的にクラウドアーキテクチャ図を描き、リアルタイムで設計エラーを検知し、瞬時に実稼働可能なTerraform（IaC）コードを書き出せるWebアプリケーションです。

---

### 💡 プロジェクトの目的と解決する課題 (Objective & Problem Solved)

#### **1. 解決したい課題**
* **Terraform（IaC）の導入障壁:** インフラのコード化（IaC）は現代の開発において必須ですが、Terraformの記述文法（HCL）の習得や設定ファイルの整合性を維持することは難しく、開発者の大きな負担になっています。
* **手動による不正確なコスト見積もり:** インフラ構成の変更に伴う月額費用の計算は複雑で、スプレッドシート等を用いた手動計算はミスが発生しやすいです。
* **設計ミス（構成不備）のデプロイ前検知の難しさ:** 「RDSがEC2インスタンスに接続されていない」「Load Balancerのターゲットグループが未指定」といった設計ミスは、実際にTerraformを実行（apply）するかAWSコンソールで作成するまで検知しづらく、デプロイ時のエラー多発の原因になります。

#### **2. 解決のアプローチ（本システムの役割）**
本プラットフォームは、ドラッグ＆ドロップによる**「ビジュアル設計（視覚的デザイン）」**と、コード生成および検証の**「エンジニアリング（自動化）」**をシームレスに結合します。これにより、インフラ構成図がそのまま検証済みのTerraformコードとなり、即座にデプロイできる環境を提供します。

---

### 🛠️ 担当した開発範囲と技術的な工夫・こだわり (My Role & Engineering Highlights)

個人開発（Solo Developer）として、要件定義・UI設計・フロントエンド/バックエンドロジック・AWS S3 API連携のすべてを1から構築しました。特に力を入れた技術的なポイントは以下の通りです：

* **1. グラフデータからTerraform（HCL）への自動コンパイラ (`lib/terraform.ts`)**
  * React Flowから取得したノード（AWSコンポーネント）とエッジ（接続関係）のトポロジー構造を解析し、依存関係（`depends_on`）やVPC、セキュリティグループ（SG）設定を動的に構築するコンパイラを自作。
  * EC2とRDSが結線された場合に、RDS側のセキュリティグループに「EC2のSGからのポート5432（Postgres）通信を許可するインバウンドルール（`aws_security_group_rule`）」を自動生成するロジックや、CloudFrontとS3間のOAC（Origin Access Control）自動生成など、実用性の高いIaCコード出力を実現しました。
* **2. ベストプラクティス検証・ヘルススコアエンジン (`lib/validation.ts`)**
  * AWS Well-Architectedフレームワークの思想に基づき、リアルタイムで構成の不整合（接続されていない孤立ノード、ロードバランサーの接続先不足など）を検出する検証ロジックを実装。
  * 0から100点の減点方式で「ヘルススコア」を算出・可視化し、設計者に具体的な修正アクション（Recommendations）を提案します。
* **3. リアルタイム月額コスト計算エンジン (`lib/cost-estimation.ts`)**
  * 選択されたリソースタイプ（EC2の`t3.micro`やRDSの`db.t3.micro`など）に基づき、概算月額費用を自動計算。パラメータが変更されるとリアルタイムで合計費用を更新し、コスト意識の高い設計を可能にします。
* **4. Next.js 15 (Turbopack) & React 19 / TypeScript での型安全な実装**
  * Next.jsのApp Router構成を採用し、S3への画像・PDFエクスポートデータを保存するAPIエンドポイントをRoute Handlersで実装。
  * 全てのモジュールはTypeScriptのStrictモード下で実装され、コンポーネントやデータのやり取りにおいて静的型安全を徹底しています。

---

### 🚀 主な機能

* 📐 **ビジュアル・トポロジーモデラー** — ドラッグ＆ドロップでEC2、S3、RDS、Lambda、ALB、CloudFrontなどのAWSコンポーネントを配置し、アニメーション付きのデータフローの線で接続。
* 🤖 **アーキテクチャ検証 ＆ ヘルス判定エンジン** — AWSのベストプラクティスに基づくリアルタイム監査：
  * RDSデータベースはEC2インスタンスへのリンクが必要。
  * Load Balancerは有効なEC2ターゲットへルートする必要がある。
  * CloudFront CDNはS3オリジンまたはApplication Load Balancerをターゲットとする。
  * 完全に孤立している未使用リソースを自動検出。
* 💸 **リアルタイムコスト見積もり** — 設計の変更に合わせて月額費用を自動算出。予算に合わせたスペック選定を強力にサポート。
* 📝 **Terraform (IaC) コードエクスポート** — ビジュアル設計図を、即座にデプロイ可能なHCLファイル（`main.tf`、`variables.tf`、`providers.tf`、`outputs.tf`）へと変換してダウンロード可能。
* ☁️ **S3 クラウド共有 (AWS SDK v3)** — キャンバスを画像としてキャプチャし、S3へセキュアにアップロード。共有URLやLinkedInでのワンクリックシェアバッジを生成。
* 🗂️ **設計テンプレート（プリセット）機能** — 以下のような定番構成をワンクリックで展開：
  * **3-Tier Web App** (CloudFront CDN ➔ ALB ➔ 2x EC2 App ➔ Postgres RDS)
  * **Serverless Stack** (CloudFront ➔ S3 Frontend & Lambda API ➔ Aurora RDS)
  * **Static Website** (CloudFront ➔ S3 Bucket)
  * **Microservices Stack** (ALB Gateway ➔ 3x EC2 APIs ➔ Shared DB)

---

## 🇬🇧 English (英語)

### 🏆 Portfolio Centerpiece / Primary Project
This repository is the **flagship project of my software engineering portfolio**, representing the highest concentration of my development hours, research, and technical execution.
It is a production-ready, interactive web application that allows cloud engineers and architects to design AWS topologies visually, automatically audit configuration health in real time, estimate hosting costs instantly, and generate production-ready, syntax-valid Terraform (HCL) templates.

---

### 💡 Objective & Problem Solved

#### **1. The Problem**
* **Steep Learning Curve for IaC:** Adopting Infrastructure as Code (IaC) via Terraform requires deep knowledge of HCL configuration syntax, resource properties, and cloud dependencies, which slows down development teams.
* **Manual and Inaccurate Cost Estimations:** Calculating monthly cloud costs using static spreadsheets is tedious, outdated, and prone to costly mathematical errors.
* **Late-Stage Configuration Auditing:** Errors like isolated RDS databases, missing target groups on Load Balancers, or misconfigured CDN origins are typically caught only during late deployment phases (or worse, in production), leading to wasted developer hours.

#### **2. The Solution**
This platform bridges the gap between **visual cloud architecture** and **infrastructure engineering**. By translating visual drag-and-drop representations into compliance-validated, fully structured Terraform files, it turns the architecture diagram into the actual, immediate deployment source of truth.

---

### 🛠️ Scope of Work & Engineering Highlights (My Contribution)

As the sole author and engineer of this project, I developed all layers from UX/UI styling to graph parsing pipelines and backend integrations. Key engineering achievements include:

* **1. Custom Graph-to-HCL AST Compiler (`lib/terraform.ts`)**
  * Wrote a custom compiler that traverses React Flow's graph nodes (AWS resources) and edges (inter-connections) to synthesize valid Terraform configurations (`main.tf`, `variables.tf`, `providers.tf`, `outputs.tf`).
  * Implemented advanced relation mapper logic: when an EC2 instance is connected to an RDS node, the compiler automatically appends a dedicated security group ingress rule (`aws_security_group_rule`) permitting port 5432 ingress from the EC2's security group. It also maps CloudFront-to-S3 relations directly into S3 Origin Access Control (OAC) configurations.
* **2. AWS Well-Architected Health Validation Engine (`lib/validation.ts`)**
  * Developed a real-time rule engine that audits the canvas layout. It flags orphan resources, computes a **0-100 Health Score**, and issues dynamic UI warnings along with clickable step-by-step mitigation advice.
* **3. Dynamic Monthly Cost Estimator (`lib/cost-estimation.ts`)**
  * Designed a modular, reactive cost engine that updates total estimated monthly expenses as nodes are dragged, re-provisioned, or deleted, allowing cost-driven design choices.
* **4. Modern Next.js 15 (Turbopack) & Strict TypeScript Stack**
  * Built using Next.js App Router and React 19. Leveraged Route Handlers for the secure Base64 screenshot compilation and upload API to AWS S3, utilizing `@aws-sdk/client-s3`.
  * Enforced strict TypeScript configurations across the codebase for type safety in diagram state updates and compiler templates.

---

### 🚀 Key Features

* 📐 **Visual Topology Modeler** — Drag-and-drop AWS components (EC2, S3, RDS, Lambda, Application Load Balancer, CloudFront) and connect them with animated data-flow arrows.
* 🤖 **Architecture Validation & Health Engine** — Real-time infrastructure compliance auditing with a **0-100 Health Score** based on AWS best practices:
  * RDS databases must be linked to EC2 instances.
  * Load Balancers must route to EC2 compute targets.
  * CloudFront CDNs must target S3 origins or Application Load Balancers.
  * Auto-detects and flags isolated/orphaned resources.
* 💸 **Real-Time Cost Estimator** — Live monthly pricing estimates calculated automatically as you design, providing pre-sales and architectural cost clarity.
* 📝 **Terraform (IaC) Code Exporter** — Translates the visual diagram into structured HCL files (`main.tf`, `variables.tf`, `providers.tf`, `outputs.tf`) ready to run.
* ☁️ **S3 Cloud Share (AWS SDK v3)** — Base64 diagram capture and secure backend upload to Amazon S3, generating a public asset URL with quick copy actions and LinkedIn share badges.
* 🗂️ **Architectural Presets (Templates)** — Load pre-configured patterns instantly:
  * *3-Tier Web App* (CloudFront CDN ➔ ALB ➔ 2x EC2 App ➔ Postgres RDS)
  * *Serverless Stack* (CloudFront ➔ S3 Frontend & Lambda API ➔ Aurora RDS)
  * *Static Website* (CloudFront ➔ S3 Bucket)
  * *Microservices Stack* (ALB Gateway ➔ 3x EC2 APIs ➔ Shared DB)
* 💾 **Save & Load** — Save designs locally in the browser or export them as JSON configuration files.

---

## 🛠️ Tech Stack

* **Core Framework:** [Next.js 15](https://nextjs.org/) (App Router, Turbopack)
* **Diagram Graph Engine:** [React Flow (@xyflow/react)](https://reactflow.dev/)
* **AWS Integration:** [AWS SDK v3 S3 Client](https://github.com/aws/aws-sdk-js-v3)
* **Document Compilation:** [jsPDF](https://github.com/parallax/jsPDF) & [html-to-image](https://github.com/bubkoo/html-to-image)
* **Styling:** TailwindCSS v4
* **Language:** TypeScript (Strict compliance)

---

## ⚙️ Setup & Deployment

### 1. Environment Configuration
Create a `.env.local` file at the root of the project using the template in `.env.example`:

```ini
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=ap-northeast-1
AWS_S3_BUCKET_NAME=your_s3_bucket_name
```

### 2. Local Run
Install dependencies and launch the Turbopack server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start designing.

### 3. Vercel Deployment
Deploy securely to Vercel by importing the GitHub repository and adding the four `AWS_*` environment keys under your Vercel Project Settings.
