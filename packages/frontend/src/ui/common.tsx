import { Box, Text, type BoxProps, type TextProps } from "@chakra-ui/react";
import type { Address, UnixSeconds } from "@dotsweb3/protocol";
import { formatCountdown } from "../state/session";

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** ux-plan §4: "you" replaces the player's own address; otherwise 0x1234…abcd (ENS later). */
export function AddressLabel({ address, self, ...rest }: { address: Address; self?: Address | null } & TextProps) {
  const isMe = !!self && self.toLowerCase() === address.toLowerCase();
  return (
    <Text as="span" fontFamily={isMe ? undefined : "mono"} title={address} {...rest}>
      {isMe ? "you" : shortAddress(address)}
    </Text>
  );
}

export function addressText(address: Address, me?: Address | null): string {
  return me && me.toLowerCase() === address.toLowerCase() ? "you" : shortAddress(address);
}

/** m:ss to a machine timestamp; red under 10 s. */
export function Countdown({ target, now, ...rest }: { target: UnixSeconds; now: UnixSeconds } & TextProps) {
  const left = target - now;
  return (
    <Text as="span" fontFamily="mono" color={left < 10 ? "danger" : undefined} {...rest}>
      {formatCountdown(left)}
    </Text>
  );
}

export function Panel(props: BoxProps) {
  return <Box bg="surface.raised" borderWidth="1px" borderColor="surface.overlay" borderRadius="md" p="5" {...props} />;
}
