import { ChakraProvider, Code, Container, Heading, List, Text } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { WagmiProvider } from "wagmi";
import App from "./App";
import { createInspect } from "./cartesi/inspect";
import { NoticeStore } from "./cartesi/notices";
import { createNodeRpc } from "./cartesi/rpc";
import { ConfigError, getConfig } from "./config";
import { ServicesProvider, type Services } from "./services";
import { system } from "./theme";
import { TxProvider } from "./tx";
import { createWagmiConfig } from "./wallet/wagmi";

function buildServices(): Services {
  const config = getConfig();
  const rpc = createNodeRpc(config.nodeRpcUrl, config.appAddress);
  const notices = new NoticeStore(rpc);
  notices.start();
  return { config, rpc, inspect: createInspect(config.inspectUrl), notices, wagmi: createWagmiConfig(config) };
}

function ConfigProblem({ error }: { error: ConfigError }) {
  return (
    <Container py="16" maxW="2xl">
      <Heading mb="4">Frontend not configured</Heading>
      <Text mb="3">
        Start the dev server with a mode that has an env file, e.g.{" "}
        <Code>npm run dev -w @dotsweb3/frontend -- --mode devnet</Code> with{" "}
        <Code>packages/frontend/.env.devnet</Code> (copy <Code>.env.example</Code>).
      </Text>
      <List.Root ps="4">
        {error.problems.map((p) => (
          <List.Item key={p}>{p}</List.Item>
        ))}
      </List.Root>
    </Container>
  );
}

let content: ReactNode;
try {
  const services = buildServices();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 5_000 } } });
  content = (
    <WagmiProvider config={services.wagmi}>
      <QueryClientProvider client={queryClient}>
        <ServicesProvider value={services}>
          <BrowserRouter>
            <TxProvider>
              <App />
            </TxProvider>
          </BrowserRouter>
        </ServicesProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  content = <ConfigProblem error={err} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ChakraProvider value={system}>{content}</ChakraProvider>
  </StrictMode>,
);
