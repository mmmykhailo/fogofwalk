package net.mykhailo.fogofwalk.trails;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmReader;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.net.URI;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Planetiler profile for Fog of Walk trail archive schema v1. */
public final class TrailProfile implements Profile {
  public static final int SCHEMA_VERSION = 1;
  public static final int MIN_ZOOM = 12;
  public static final int MAX_ZOOM = 12;
  public static final String SOURCE_LAYER = "trails";
  public static final String PINNED_PLANETILER_VERSION = "0.8.14";

  private final TrailBuildReport report;

  public TrailProfile() {
    this(new TrailBuildReport());
  }

  public TrailProfile(TrailBuildReport report) {
    this.report = report;
  }

  @Override
  public List<OsmRelationInfo> preprocessOsmRelation(OsmElement.Relation relation) {
    Optional<TrailClassifier.RelationClassification> classification =
      TrailClassifier.classifyRelation(relation.id(), relation.tags());
    if (classification.isEmpty()) return null;

    TrailClassifier.RelationClassification value = classification.get();
    TrailRelationInfo info = new TrailRelationInfo(
      value.id(), value.kind(), value.networkRank(), value.color(),
      value.superRoute(), value.unsupportedColor()
    );
    report.acceptedRelation(info);
    return List.of(info);
  }

  @Override
  public void processFeature(SourceFeature sourceFeature, FeatureCollector features) {
    if (!sourceFeature.canBeLine()) return;

    List<OsmReader.RelationMember<TrailRelationInfo>> relationMembers =
      sourceFeature.relationInfo(TrailRelationInfo.class, true);
    if (relationMembers.isEmpty()) return;
    report.memberWaySeen();

    List<TrailClassifier.Membership> memberships = new ArrayList<>(relationMembers.size());
    for (OsmReader.RelationMember<TrailRelationInfo> member : relationMembers) {
      TrailRelationInfo relation = member.relation();
      memberships.add(new TrailClassifier.Membership(
        relation.id(), relation.kind(), relation.networkRank(), relation.color(),
        member.isSuperRelation()
      ));
    }

    TrailClassifier.VisualSelection selection =
      TrailClassifier.selectVisualFeatures(memberships);
    report.overlapKeysDropped(selection.droppedKeys());
    if (selection.features().isEmpty()) return;

    // Resolve the geometry once so malformed ways are counted and skipped while
    // the rest of the archive continues to build.
    try {
      sourceFeature.line();
    } catch (GeometryException exception) {
      report.invalidGeometry();
      return;
    }

    for (TrailClassifier.VisualFeature visual : selection.features()) {
      features.line(SOURCE_LAYER)
        .setAttr("kind", visual.kind().value())
        .setAttr("color", visual.color())
        .setAttr("offset", visual.offset())
        .setAttr("sort", visual.sort())
        .setZoomRange(MIN_ZOOM, MAX_ZOOM)
        .setMinPixelSize(0);
    }
    report.emittedFeatures(selection.features().size());
  }

  @Override
  public List<VectorTile.Feature> postProcessLayerFeatures(
    String layer,
    int zoom,
    List<VectorTile.Feature> items
  ) {
    if (!SOURCE_LAYER.equals(layer)) return items;
    return FeatureMerge.mergeLineStrings(items, 0.5, 0.1, 4);
  }

  @Override
  public String name() {
    return "Fog of Walk marked trails";
  }

  @Override
  public String description() {
    return "Marked hiking and cycling routes derived from OpenStreetMap relations";
  }

  @Override
  public String attribution() {
    return Profile.OSM_ATTRIBUTION;
  }

  @Override
  public boolean isOverlay() {
    return true;
  }

  public static void main(String[] args) throws Exception {
    run(parseBuildInputs(args));
  }

  static void run(BuildInputs inputs) throws Exception {
    verifySourceChecksum(inputs.osmPath(), inputs.osmSourceChecksum());
    Files.createDirectories(inputs.output().toAbsolutePath().getParent());
    if (Files.exists(inputs.output())) {
      throw new IllegalArgumentException("refusing to overwrite existing archive");
    }

    long started = System.nanoTime();
    TrailBuildReport report = new TrailBuildReport();
    String[] planetilerArgs = inputs.planetilerArguments();
    Planetiler.create(Arguments.fromArgsOrConfigFile(planetilerArgs))
      .setProfile(new TrailProfile(report))
      .addOsmSource("osm", inputs.osmPath(), inputs.osmSourceUrl())
      .overwriteOutput(inputs.output())
      .run();

    if (!Files.isRegularFile(inputs.output())) {
      throw new IOException("Planetiler did not create the requested archive");
    }
    String archiveSha256 = sha256(inputs.output());
    long wallTimeMs = (System.nanoTime() - started) / 1_000_000;
    Files.createDirectories(inputs.report().toAbsolutePath().getParent());
    report.write(
      inputs.report(), inputs.osmSnapshot(), inputs.osmSourceUrl(),
      inputs.osmSourceChecksum(), PINNED_PLANETILER_VERSION, inputs.output(),
      archiveSha256, wallTimeMs, inputs.minZoom(), inputs.maxZoom()
    );
    System.out.println("Built trail archive " + inputs.output().getFileName());
  }

  record BuildInputs(
    Path osmPath,
    String osmSourceUrl,
    String osmSourceChecksum,
    Path output,
    Path report,
    String osmSnapshot,
    int minZoom,
    int maxZoom,
    String[] planetilerArguments
  ) {}

  static BuildInputs parseBuildInputs(String[] rawArgs) throws IOException {
    Map<String, String> values = new LinkedHashMap<>();
    for (String raw : rawArgs) {
      if (!raw.startsWith("--") || !raw.contains("=")) {
        throw new IllegalArgumentException("arguments must use --name=value");
      }
      String[] pair = raw.substring(2).split("=", 2);
      String key = pair[0].replace('_', '-');
      if (key.isBlank() || pair[1].isBlank()) {
        throw new IllegalArgumentException("argument " + key + " must not be blank");
      }
      if (values.put(key, pair[1]) != null) {
        throw new IllegalArgumentException("duplicate argument " + key);
      }
    }

    Path osmPath = absolutePath(values, "osm-path");
    if ("planet-latest.osm.pbf".equals(osmPath.getFileName().toString())) {
      throw new IllegalArgumentException("mutable planet-latest.osm.pbf is not reproducible");
    }
    if (!osmPath.getFileName().toString().endsWith(".osm.pbf")) {
      throw new IllegalArgumentException("--osm-path must point to an .osm.pbf file");
    }
    if (!Files.isRegularFile(osmPath)) throw new IOException("OSM input is not a file");

    String sourceUrl = required(values, "osm-source-url");
    validateSourceUrl(sourceUrl);
    String checksum = required(values, "osm-source-checksum");
    normalizeSha256(checksum);
    Path output = absolutePath(values, "output");
    if (!output.getFileName().toString().endsWith(".pmtiles")) {
      throw new IllegalArgumentException("--output must be a .pmtiles file");
    }
    if (Files.exists(output)) throw new IllegalArgumentException("output already exists");
    Path report = absolutePath(values, "report");
    int schemaVersion = integer(values, "schema-version");
    int minZoom = integer(values, "minzoom");
    int maxZoom = integer(values, "maxzoom");
    if (schemaVersion != SCHEMA_VERSION || minZoom != MIN_ZOOM || maxZoom != MAX_ZOOM) {
      throw new IllegalArgumentException("only schema v1 at z12 is supported");
    }

    List<String> planetilerArgs = new ArrayList<>();
    for (Map.Entry<String, String> entry : values.entrySet()) {
      if (switch (entry.getKey()) {
        case "osm-path", "osm-source-url", "osm-source-checksum", "output", "report",
          "schema-version", "osm-snapshot" -> true;
        default -> false;
      }) continue;
      planetilerArgs.add(entry.getKey().replace('-', '_') + "=" + entry.getValue());
    }
    planetilerArgs.add("minzoom=" + minZoom);
    planetilerArgs.add("maxzoom=" + maxZoom);
    return new BuildInputs(
      osmPath, sourceUrl, checksum, output, report,
      values.getOrDefault("osm-snapshot", "unknown"), minZoom, maxZoom,
      planetilerArgs.toArray(String[]::new)
    );
  }

  private static Path absolutePath(Map<String, String> values, String key) {
    Path path = Path.of(required(values, key));
    if (!path.isAbsolute()) throw new IllegalArgumentException("--" + key + " must be absolute");
    return path.normalize();
  }

  private static String required(Map<String, String> values, String key) {
    String value = values.get(key);
    if (value == null || value.isBlank()) throw new IllegalArgumentException("missing --" + key);
    return value;
  }

  private static int integer(Map<String, String> values, String key) {
    try {
      return Integer.parseInt(required(values, key));
    } catch (NumberFormatException exception) {
      throw new IllegalArgumentException("--" + key + " must be an integer", exception);
    }
  }

  private static void validateSourceUrl(String value) {
    URI uri = URI.create(value);
    String scheme = uri.getScheme();
    if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
      || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
      throw new IllegalArgumentException("OSM source URL must be a public credential-free URL");
    }
  }

  static String normalizeSha256(String value) {
    String candidate = value.trim().toLowerCase(java.util.Locale.ROOT);
    if (candidate.startsWith("sha256:")) candidate = candidate.substring("sha256:".length());
    if (!candidate.matches("[0-9a-f]{64}")) {
      throw new IllegalArgumentException("OSM source checksum must be a SHA-256 value");
    }
    return candidate;
  }

  static void verifySourceChecksum(Path path, String publishedChecksum) throws IOException {
    String expected = normalizeSha256(publishedChecksum);
    String actual = sha256(path);
    if (!expected.equals(actual)) throw new IOException("OSM source checksum mismatch");
  }

  static String sha256(Path path) throws IOException {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      try (InputStream input = Files.newInputStream(path)) {
        byte[] buffer = new byte[1024 * 1024];
        int read;
        while ((read = input.read(buffer)) >= 0) {
          if (read > 0) digest.update(buffer, 0, read);
        }
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException impossible) {
      throw new AssertionError(impossible);
    }
  }
}
