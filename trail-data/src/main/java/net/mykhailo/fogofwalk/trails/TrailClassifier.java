package net.mykhailo.fogofwalk.trails;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Pure schema-v1 classification and overlap selection for OSM route relations. */
public final class TrailClassifier {
  public static final int MAX_HIKING_KEYS = 4;
  public static final double PARALLEL_LINE_SEPARATION_PX = 3d;
  public static final String HIKING_FALLBACK_COLOR = "#7e22ce";
  public static final String CYCLING_COLOR = "#ec4899";

  private static final List<String> COLOR_ORDER = List.of(
    "red", "green", "blue", "yellow", "orange", "purple", "black", "brown"
  );
  private static final Map<String, String> COLORS = Map.of(
    "red", "#d9272e",
    "green", "#15803d",
    "blue", "#1769aa",
    "yellow", "#eab308",
    "orange", "#ea580c",
    "purple", HIKING_FALLBACK_COLOR,
    "black", "#262626",
    "brown", "#854d0e"
  );
  private static final Map<String, Integer> HIKING_NETWORK_RANKS = Map.of(
    "iwn", 4, "nwn", 3, "rwn", 2, "lwn", 1
  );
  private static final Map<String, Integer> CYCLING_NETWORK_RANKS = Map.of(
    "icn", 4, "ncn", 3, "rcn", 2, "lcn", 1
  );

  private TrailClassifier() {}

  public enum Kind {
    HIKING("hiking"),
    CYCLING("cycling");

    private final String value;

    Kind(String value) {
      this.value = value;
    }

    public String value() {
      return value;
    }
  }

  public record ColorNormalization(String color, boolean unsupported) {}

  public record RelationClassification(
    long id,
    Kind kind,
    int networkRank,
    String color,
    boolean superRoute,
    boolean unsupportedColor
  ) {}

  /** A relation membership attached to a line-capable way. */
  public record Membership(
    long relationId,
    Kind kind,
    int networkRank,
    String color,
    boolean inherited
  ) {}

  /** A selected feature before Planetiler turns it into a vector tile line. */
  public record VisualFeature(
    long relationId,
    Kind kind,
    String color,
    double offset,
    int sort
  ) {}

  public record VisualSelection(List<VisualFeature> features, int droppedKeys) {
    public VisualSelection {
      features = List.copyOf(features);
    }
  }

  /** Classifies only the exact relation forms accepted by schema v1. */
  public static Optional<RelationClassification> classifyRelation(
    long id,
    Map<String, ?> tags
  ) {
    String type = tag(tags, "type");
    if (!"route".equals(type) && !"superroute".equals(type)) return Optional.empty();

    Kind kind = switch (tag(tags, "route")) {
      case "hiking", "foot" -> Kind.HIKING;
      case "bicycle" -> Kind.CYCLING;
      default -> null;
    };
    if (kind == null) return Optional.empty();

    int rank = networkRank(kind, tag(tags, "network"));
    ColorNormalization color = kind == Kind.HIKING
      ? normalizeHikingColor(tags)
      : new ColorNormalization(CYCLING_COLOR, false);
    return Optional.of(new RelationClassification(
      id,
      kind,
      rank,
      color.color(),
      "superroute".equals(type),
      color.unsupportedColor()
    ));
  }

  public static int networkRank(Kind kind, String network) {
    return (kind == Kind.HIKING ? HIKING_NETWORK_RANKS : CYCLING_NETWORK_RANKS)
      .getOrDefault(network, 0);
  }

  /** Applies osmc:symbol, colour, color precedence and the closed v1 palette. */
  public static ColorNormalization normalizeHikingColor(Map<String, ?> tags) {
    if (tags.containsKey("osmc:symbol")) {
      return normalizeToken(firstSymbolComponent(tags.get("osmc:symbol")));
    }
    if (tags.containsKey("colour")) return normalizeToken(tags.get("colour"));
    if (tags.containsKey("color")) return normalizeToken(tags.get("color"));
    return new ColorNormalization(HIKING_FALLBACK_COLOR, false);
  }

  /** Selects one feature per visual key and calculates centered screen offsets. */
  public static VisualSelection selectVisualFeatures(List<Membership> memberships) {
    Map<String, Membership> strongestByKey = new HashMap<>();
    for (Membership membership : memberships) {
      String key = visualKey(membership);
      Membership previous = strongestByKey.get(key);
      if (previous == null || stronger(membership, previous)) {
        strongestByKey.put(key, membership);
      }
    }

    List<Membership> hiking = new ArrayList<>();
    Membership cycling = null;
    for (Membership membership : strongestByKey.values()) {
      if (membership.kind() == Kind.HIKING) hiking.add(membership);
      else if (cycling == null || stronger(membership, cycling)) cycling = membership;
    }

    hiking.sort(Comparator
      .comparingInt(Membership::networkRank).reversed()
      .thenComparingInt(membership -> colorOrder(membership.color()))
      .thenComparingLong(Membership::relationId));

    int dropped = Math.max(0, hiking.size() - MAX_HIKING_KEYS);
    if (hiking.size() > MAX_HIKING_KEYS) {
      hiking = new ArrayList<>(hiking.subList(0, MAX_HIKING_KEYS));
    }

    List<VisualFeature> result = new ArrayList<>(hiking.size() + (cycling == null ? 0 : 1));
    for (int index = 0; index < hiking.size(); index++) {
      Membership membership = hiking.get(index);
      double offset = (index - (hiking.size() - 1) / 2d) * PARALLEL_LINE_SEPARATION_PX;
      result.add(new VisualFeature(
        membership.relationId(), membership.kind(), membership.color(), offset,
        10 + membership.networkRank()
      ));
    }
    if (cycling != null) {
      result.add(new VisualFeature(
        cycling.relationId(), Kind.CYCLING, CYCLING_COLOR, 0d,
        20 + cycling.networkRank()
      ));
    }
    return new VisualSelection(result, dropped);
  }

  public static int colorOrder(String color) {
    int index = COLOR_ORDER.indexOf(color);
    return index < 0 ? COLOR_ORDER.size() : index;
  }

  private static String visualKey(Membership membership) {
    return membership.kind() == Kind.HIKING
      ? membership.kind().value() + ":" + membership.color()
      : membership.kind().value();
  }

  private static boolean stronger(Membership candidate, Membership previous) {
    return candidate.networkRank() > previous.networkRank()
      || (candidate.networkRank() == previous.networkRank()
        && candidate.relationId() < previous.relationId());
  }

  private static String firstSymbolComponent(Object raw) {
    String value = raw == null ? "" : String.valueOf(raw).trim();
    int separator = value.indexOf(':');
    return separator < 0 ? value : value.substring(0, separator);
  }

  private static ColorNormalization normalizeToken(Object raw) {
    String token = raw == null ? "" : String.valueOf(raw).trim().toLowerCase(java.util.Locale.ROOT);
    String color = COLORS.get(token);
    return color == null
      ? new ColorNormalization(HIKING_FALLBACK_COLOR, true)
      : new ColorNormalization(color, false);
  }

  private static String tag(Map<String, ?> tags, String key) {
    Object value = tags.get(key);
    return value == null ? "" : String.valueOf(value);
  }
}
