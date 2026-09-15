import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { JourneyArt } from './JourneyArt';
import { AppText } from './AppText';

/** A route with two stops, drawn natively so it stays crisp at every density. */
export function RouteMark({ inverse = false }: { inverse?: boolean }) {
  const color = inverse ? colors.paper : colors.rail;
  return (
    <View style={styles.mark} accessible={false}>
      <View style={[styles.route, { borderColor: color }]} />
      <View style={[styles.start, { backgroundColor: color }]} />
      <View style={[styles.end, { backgroundColor: color }]} />
    </View>
  );
}

export function Brand({ audience }: { audience: string }) {
  return (
    <View style={styles.brand}>
      <View style={styles.brandIcon}>
        <RouteMark inverse />
      </View>
      <AppText preset="section" style={styles.wordmark}>
        servisapp
      </AppText>
      <View style={styles.brandDivider} />
      <AppText preset="caption">{audience}</AppText>
    </View>
  );
}

export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('tr-TR');
  return (
    <View style={[styles.avatar, large && styles.avatarLarge]} accessible={false}>
      <AppText preset={large ? 'title' : 'strong'} color={colors.rail}>
        {initials}
      </AppText>
    </View>
  );
}

export function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.section}>
      <AppText preset="section" style={styles.sectionTitle}>
        {title}
      </AppText>
      {detail ? <AppText preset="caption">{detail}</AppText> : null}
    </View>
  );
}

export function AuthIntro({
  audience,
  title,
  body,
}: {
  audience: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.intro}>
      <Brand audience={audience} />
      <View style={styles.introHeading}>
        <AppText preset="focus" color={colors.paper}>
          {title}
        </AppText>
        <AppText preset="meta" color="#D1DDD6" style={styles.introBody}>
          {body}
        </AppText>
        <JourneyArt compact />
      </View>
    </View>
  );
}

export function Surface({ children }: { children: ReactNode }) {
  return <View style={styles.surface}>{children}</View>;
}

const styles = StyleSheet.create({
  mark: { width: 26, height: 26 },
  route: {
    position: 'absolute',
    left: 6,
    top: 5,
    width: 15,
    height: 17,
    borderWidth: 2,
    borderRadius: 7,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  start: { position: 'absolute', left: 3, top: 2, width: 7, height: 7, borderRadius: 4 },
  end: { position: 'absolute', right: 2, bottom: 1, width: 7, height: 7, borderRadius: 4 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.rail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { letterSpacing: -0.6 },
  brandDivider: { height: 16, width: 1, backgroundColor: colors.line, marginHorizontal: 2 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: '#E8D9C3',
  },
  avatarLarge: { width: 72, height: 72, borderRadius: 24 },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xl,
    marginBottom: space.md,
  },
  sectionTitle: { flex: 1 },
  intro: { marginTop: space.lg, marginBottom: space.xl },
  introHeading: {
    marginTop: 28,
    gap: space.sm,
    backgroundColor: colors.rail,
    borderRadius: 28,
    padding: space.xl,
    paddingBottom: 0,
    overflow: 'hidden',
  },
  introBody: { maxWidth: 380 },
  surface: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    marginBottom: space.md,
  },
});
