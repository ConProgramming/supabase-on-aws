import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import { LoadBalancerV2Origin, HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { WebACL } from './aws-waf-v2';

interface SupabaseCdnProps {
  origin: string|elb.ILoadBalancerV2;
  requestRateLimit: number;
}

interface BehaviorProps {
  pathPattern: string;
  origin: string|elb.ILoadBalancerV2;
}

export class SupabaseCdn extends Construct {
  distribution: cf.Distribution;
  defaultBehaviorOptions: cf.AddBehaviorOptions;

  constructor(scope: Construct, id: string, props: SupabaseCdnProps) {
    super(scope, id);

    const origin = (typeof props.origin == 'string')
      ? new HttpOrigin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY })
      : new LoadBalancerV2Origin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY });

    const webAcl = new WebACL(this, 'WebAcl', {
      Scope: 'CLOUDFRONT',
      Rules: [
        {
          Name: 'AWS-AWSManagedRulesAmazonIpReputationList',
          Priority: 0,
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'AWS-AWSManagedRulesAmazonIpReputationList',
          },
          OverrideAction: { None: {} },
        },
        {
          Name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          Priority: 1,
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          },
          OverrideAction: { None: {} },
        },
        {
          Name: 'AWS-AWSManagedRulesSQLiRuleSet',
          Priority: 2,
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesSQLiRuleSet',
              Version: 'Version_2.0',
            },
          },
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'AWS-AWSManagedRulesSQLiRuleSet',
          },
          OverrideAction: { None: {} },
        },
        {
          Name: 'AWS-AWSManagedRulesBotControlRuleSet',
          Priority: 3,
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesBotControlRuleSet',
              ExcludedRules: [
                { Name: 'CategoryHttpLibrary' },
                { Name: 'SignalNonBrowserUserAgent' },
              ],
            },
          },
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'AWS-AWSManagedRulesBotControlRuleSet',
          },
          OverrideAction: { None: {} },
        },
        {
          Name: 'AWS-AWSManagedRulesATPRuleSet',
          Priority: 4,
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: 'AWS',
              Name: 'AWSManagedRulesATPRuleSet',
              ExcludedRules: [
                { Name: 'SignalMissingCredential' },
              ],
              ManagedRuleGroupConfigs: [
                { LoginPath: '/auth/v1/token' },
                { PayloadType: 'JSON' },
                { UsernameField: { Identifier: '/email' } },
                { PasswordField: { Identifier: '/password' } },
              ],
            },
          },
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'AWS-AWSManagedRulesATPRuleSet',
          },
          OverrideAction: { None: {} },
        },
        {
          Name: 'RateBasedRule',
          Priority: 5,
          Statement: {
            RateBasedStatement: {
              Limit: props.requestRateLimit,
              AggregateKeyType: 'IP',
            },
          },
          VisibilityConfig: {
            SampledRequestsEnabled: true,
            CloudWatchMetricsEnabled: true,
            MetricName: 'RateBasedRule',
          },
          Action: { Block: {} },
        },
      ],
    });

    const cachePolicy = new cf.CachePolicy(this, 'CachePolicy', {
      comment: 'Policy for Supabase API',
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(600),
      defaultTtl: cdk.Duration.seconds(2),
      headerBehavior: cf.CacheHeaderBehavior.allowList('Authorization', 'Host'),
      queryStringBehavior: cf.CacheQueryStringBehavior.all(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    //const originRequestHeaders = [
    //  'Access-Control-Request-Headers',
    //  'Access-Control-Request-Method',
    //  'Accept-Profile',
    //  'Origin',
    //  'Referer',
    //  'Sec-WebSocket-Extensions',
    //  'Sec-WebSocket-Key',
    //  'Sec-WebSocket-Version',
    //  'X-Client-Info',
    //  'Apikey',
    //];

    //const originRequestPolicy = new cf.OriginRequestPolicy(this, 'OriginRequestPolicy', {
    //  comment: 'Policy for Supabase API',
    //  headerBehavior: cf.OriginRequestHeaderBehavior.allowList(...originRequestHeaders),
    //  queryStringBehavior: cf.OriginRequestQueryStringBehavior.all(),
    //});

    const responseHeadersPolicy = new cf.ResponseHeadersPolicy(this, 'ResponseHeadersPolicy', {
      comment: 'Policy for Supabase API',
      customHeadersBehavior: {
        customHeaders: [
          { header: 'server', value: 'cloudfront', override: true },
        ],
      },
    });

    this.defaultBehaviorOptions = {
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cf.AllowedMethods.ALLOW_ALL,
      cachePolicy,
      originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER,
      responseHeadersPolicy,
    };

    const staticContentBehavior: cf.BehaviorOptions = {
      ...this.defaultBehaviorOptions,
      cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
      origin,
    };

    this.distribution = new cf.Distribution(this, 'Distribution', {
      webAclId: webAcl.arn,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      comment: `Supabase - CDN (${this.node.path}/Distribution)`,
      defaultBehavior: {
        ...this.defaultBehaviorOptions,
        origin,
      },
      additionalBehaviors: {
        '*.css': staticContentBehavior,
        '*.png': staticContentBehavior,
        '*.jpg': staticContentBehavior,
        '*.jpeg': staticContentBehavior,
        '*.svg': staticContentBehavior,
        '*.woff': staticContentBehavior,
        '*.woff2': staticContentBehavior,
        '*.js': staticContentBehavior,
      },
      errorResponses: [
        { httpStatus: 500, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 501, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 502, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 503, ttl: cdk.Duration.seconds(10) },
        { httpStatus: 504, ttl: cdk.Duration.seconds(10) },
      ],
    });
  }

  addBehavior(props: BehaviorProps) {
    const origin = (typeof props.origin == 'string')
      ? new HttpOrigin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY })
      : new LoadBalancerV2Origin(props.origin, { protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY });
    this.distribution.addBehavior(props.pathPattern, origin, this.defaultBehaviorOptions);
  }
};
