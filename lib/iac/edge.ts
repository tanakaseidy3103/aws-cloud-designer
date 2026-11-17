import type { InfraResource } from "@/lib/infra/model";
import { isFrontedByCloudFront, resourcesOfType, targetsOf } from "@/lib/infra/model";
import { attr, blank, block, comment, data, raw, resource, type BodyItem } from "./hcl";
import { output, physicalName, tags, variable, type GenContext, type SectionFile } from "./context";

const certVar = (alb: string) => `${alb}_certificate_arn`;
const originDomainVar = (alb: string) => `${alb}_origin_domain_name`;

/* ======================================================================== */
/* Application Load Balancer                                                */
/* ======================================================================== */

export function generateLoadBalancers(ctx: GenContext): SectionFile | null {
  const albs = resourcesOfType(ctx.model, "load-balancer");
  if (albs.length === 0) return null;

  const items: BodyItem[] = [];
  for (const alb of albs) {
    const n = alb.tfName;
    const c = alb.config;
    const targets = targetsOf(ctx.model, alb.id, "lb-target");
    const ec2Targets = targets.filter((t) => t.type === "ec2") as InfraResource<"ec2">[];
    const fnTargets = targets.filter((t) => t.type === "lambda");
    const useLambda = ec2Targets.length === 0 && fnTargets.length > 0;
    const fn = useLambda ? fnTargets[0] : undefined;

    for (const skipped of ec2Targets.length ? fnTargets : fnTargets.slice(1)) {
      ctx.skipped.push({ resourceId: skipped.id, reason: `Not attached to load balancer "${alb.label}": one target type and at most one Lambda per ALB.` });
    }

    if (c.httpsEnabled) {
      ctx.extraVariables.push(
        variable(certVar(n), "string", `ARN of the ACM certificate for the HTTPS listener of ${n}.`, undefined, [
          block("validation", [], [
            attr("condition", raw(`can(regex("^arn:aws[a-zA-Z-]*:acm:", var.${certVar(n)}))`)),
            attr("error_message", "Must be an ACM certificate ARN."),
          ]),
        ])
      );
    }

    items.push(
      comment(`Application Load Balancer: ${alb.label.replace(/\n/g, " ")}`),
      resource("aws_lb", n, [
        attr("name", physicalName(n, 32)),
        attr("internal", c.internal),
        attr("load_balancer_type", "application"),
        attr("security_groups", [raw(`aws_security_group.${n}.id`)]),
        attr("subnets", raw(`aws_subnet.${c.internal ? "private" : "public"}[*].id`)),
        attr("drop_invalid_header_fields", true),
        attr("enable_deletion_protection", false),
        blank,
        tags(alb.label),
      ]),
      useLambda
        ? resource("aws_lb_target_group", n, [
            attr("name", physicalName(n, 32, "-tg")),
            attr("target_type", "lambda"),
          ])
        : resource("aws_lb_target_group", n, [
            attr("name", physicalName(n, 32, "-tg")),
            attr("port", 80),
            attr("protocol", "HTTP"),
            attr("target_type", "instance"),
            attr("vpc_id", raw("aws_vpc.main.id")),
            blank,
            block("health_check", [], [
              attr("path", "/"),
              attr("matcher", "200-399"),
              attr("interval", 30),
              attr("healthy_threshold", 3),
              attr("unhealthy_threshold", 3),
            ]),
          ])
    );

    for (const t of ec2Targets) {
      items.push(
        resource("aws_lb_target_group_attachment", `${n}_${t.tfName}`, [
          attr("target_group_arn", raw(`aws_lb_target_group.${n}.arn`)),
          attr("target_id", raw(`aws_instance.${t.tfName}.id`)),
          attr("port", t.config.appPort),
        ])
      );
    }

    if (fn) {
      items.push(
        resource("aws_lambda_permission", `${n}_invoke_${fn.tfName}`, [
          attr("statement_id", "AllowExecutionFromALB"),
          attr("action", "lambda:InvokeFunction"),
          attr("function_name", raw(`aws_lambda_function.${fn.tfName}.function_name`)),
          attr("principal", "elasticloadbalancing.amazonaws.com"),
          attr("source_arn", raw(`aws_lb_target_group.${n}.arn`)),
        ]),
        resource("aws_lb_target_group_attachment", `${n}_${fn.tfName}`, [
          attr("target_group_arn", raw(`aws_lb_target_group.${n}.arn`)),
          attr("target_id", raw(`aws_lambda_function.${fn.tfName}.arn`)),
          blank,
          attr("depends_on", [raw(`aws_lambda_permission.${n}_invoke_${fn.tfName}`)]),
        ])
      );
    }

    const forward = block("default_action", [], [attr("type", "forward"), attr("target_group_arn", raw(`aws_lb_target_group.${n}.arn`))]);
    items.push(
      resource("aws_lb_listener", `${n}_http`, [
        attr("load_balancer_arn", raw(`aws_lb.${n}.arn`)),
        attr("port", 80),
        attr("protocol", "HTTP"),
        blank,
        c.httpsEnabled
          ? block("default_action", [], [
              attr("type", "redirect"),
              blank,
              block("redirect", [], [attr("port", "443"), attr("protocol", "HTTPS"), attr("status_code", "HTTP_301")]),
            ])
          : forward,
      ])
    );
    if (c.httpsEnabled) {
      items.push(
        resource("aws_lb_listener", `${n}_https`, [
          attr("load_balancer_arn", raw(`aws_lb.${n}.arn`)),
          attr("port", 443),
          attr("protocol", "HTTPS"),
          attr("ssl_policy", "ELBSecurityPolicy-TLS13-1-2-2021-06"),
          attr("certificate_arn", raw(`var.${certVar(n)}`)),
          blank,
          forward,
        ])
      );
    }

    ctx.outputs.push(output(`${n}_dns_name`, `DNS name of load balancer ${n}`, `aws_lb.${n}.dns_name`));
  }

  return { file: "load_balancer.tf", items };
}

/* ======================================================================== */
/* CloudFront                                                               */
/* ======================================================================== */

export function generateDistributions(ctx: GenContext): SectionFile | null {
  const cfs = resourcesOfType(ctx.model, "cloudfront");
  if (cfs.length === 0) return null;

  const items: BodyItem[] = [];
  const usedPolicies = new Set<"optimized" | "disabled" | "allviewer">();
  const body: BodyItem[] = [];

  for (const cf of cfs) {
    const n = cf.tfName;
    const origin = targetsOf(ctx.model, cf.id, "cdn-origin")[0];
    if (!origin) {
      ctx.skipped.push({ resourceId: cf.id, reason: `CloudFront "${cf.label}" has no origin and was not generated.` });
      continue;
    }

    const isS3 = origin.type === "s3";
    const originId = `${isS3 ? "s3" : "alb"}-${origin.tfName.replace(/_/g, "-")}`;
    let originBlock: BodyItem;

    if (isS3) {
      usedPolicies.add("optimized");
      body.push(
        resource("aws_cloudfront_origin_access_control", n, [
          attr("name", physicalName(n, 64)),
          attr("description", "Signed CloudFront access to the S3 origin"),
          attr("origin_access_control_origin_type", "s3"),
          attr("signing_behavior", "always"),
          attr("signing_protocol", "sigv4"),
        ])
      );
      originBlock = block("origin", [], [
        attr("domain_name", raw(`aws_s3_bucket.${origin.tfName}.bucket_regional_domain_name`)),
        attr("origin_id", originId),
        attr("origin_access_control_id", raw(`aws_cloudfront_origin_access_control.${n}.id`)),
      ]);
    } else {
      usedPolicies.add("disabled");
      usedPolicies.add("allviewer");
      const alb = origin as InfraResource<"load-balancer">;
      const https = alb.config.httpsEnabled;
      if (https && isFrontedByCloudFront(ctx.model, alb.id) && !ctx.extraVariables.some((v) => v.labels[0] === originDomainVar(alb.tfName))) {
        ctx.extraVariables.push(
          variable(originDomainVar(alb.tfName), "string", `Domain name covered by ${certVar(alb.tfName)} that resolves to load balancer ${alb.tfName}. CloudFront validates the origin certificate against it.`)
        );
      }
      originBlock = block("origin", [], [
        attr("domain_name", raw(https ? `var.${originDomainVar(alb.tfName)}` : `aws_lb.${alb.tfName}.dns_name`)),
        attr("origin_id", originId),
        blank,
        block("custom_origin_config", [], [
          attr("http_port", 80),
          attr("https_port", 443),
          attr("origin_protocol_policy", https ? "https-only" : "http-only"),
          attr("origin_ssl_protocols", ["TLSv1.2"]),
        ]),
      ]);
    }

    body.push(
      comment(`CloudFront: ${cf.label.replace(/\n/g, " ")}`),
      resource("aws_cloudfront_distribution", n, [
        attr("enabled", true),
        attr("is_ipv6_enabled", true),
        attr("comment", cf.label.slice(0, 128)),
        attr("price_class", cf.config.priceClass),
        isS3 ? attr("default_root_object", "index.html") : null,
        blank,
        originBlock,
        blank,
        block("default_cache_behavior", [], [
          attr("target_origin_id", originId),
          attr("viewer_protocol_policy", cf.config.viewerProtocolPolicy),
          attr("allowed_methods", isS3 ? ["GET", "HEAD"] : ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]),
          attr("cached_methods", ["GET", "HEAD"]),
          attr("compress", true),
          attr("cache_policy_id", raw(`data.aws_cloudfront_cache_policy.${isS3 ? "caching_optimized" : "caching_disabled"}.id`)),
          isS3 ? null : attr("origin_request_policy_id", raw("data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id")),
        ]),
        blank,
        block("restrictions", [], [block("geo_restriction", [], [attr("restriction_type", "none")])]),
        blank,
        block("viewer_certificate", [], [attr("cloudfront_default_certificate", true)]),
        blank,
        tags(cf.label),
      ])
    );

    ctx.outputs.push(
      output(`${n}_domain_name`, `Domain name of distribution ${n}`, `aws_cloudfront_distribution.${n}.domain_name`),
      output(`${n}_distribution_id`, `ID of distribution ${n}`, `aws_cloudfront_distribution.${n}.id`)
    );
  }

  if (usedPolicies.has("optimized")) items.push(data("aws_cloudfront_cache_policy", "caching_optimized", [attr("name", "Managed-CachingOptimized")]));
  if (usedPolicies.has("disabled")) items.push(data("aws_cloudfront_cache_policy", "caching_disabled", [attr("name", "Managed-CachingDisabled")]));
  if (usedPolicies.has("allviewer")) items.push(data("aws_cloudfront_origin_request_policy", "all_viewer_except_host", [attr("name", "Managed-AllViewerExceptHostHeader")]));
  items.push(...body);

  return items.length ? { file: "cdn.tf", items } : null;
}
