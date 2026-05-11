import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const SITE_NAME = 'MyLocalTrade';
const SITE_TITLE = 'MyLocalTrade — Find verified local tradespeople in the UK';
const SITE_DESCRIPTION =
  'MyLocalTrade is the UK marketplace that connects homeowners with verified local tradespeople — find plumbers, electricians, builders and more, read reviews, request quotes and book trusted trades near you.';
const SITE_URL = 'https://mylocaltrade.co.uk';
const SOCIAL_IMAGE = '/favicon.png';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        <title>{SITE_TITLE}</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <meta
          name="keywords"
          content="local tradespeople, UK trades, plumbers, electricians, builders, find a tradesman, verified trades, hire local"
        />
        <meta name="author" content={SITE_NAME} />
        <meta name="theme-color" content="#0B1120" />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={SITE_URL} />

        {/* Open Graph */}
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:title" content={SITE_TITLE} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:image" content={SOCIAL_IMAGE} />
        <meta property="og:locale" content="en_GB" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SITE_TITLE} />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
        <meta name="twitter:image" content={SOCIAL_IMAGE} />

        {/*
          react-native-web reset and Expo's default body scroll lock. The
          `ScrollViewStyleReset` ensures <ScrollView> works in the static web
          build without conflicting with body scrolling.
        */}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #0B1120;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #0B1120;
  }
}
`;
