package net.mykhailo.fogofwalk.trails;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.LongAdder;

/** Thread-safe counters and JSON serialization for one immutable trail build. */
public final class TrailBuildReport {
  private final LongAdder acceptedRelations = new LongAdder();
  private final LongAdder hikingRelations = new LongAdder();
  private final LongAdder cyclingRelations = new LongAdder();
  private final LongAdder superRelations = new LongAdder();
  private final LongAdder memberWaysSeen = new LongAdder();
  private final LongAdder emittedFeatures = new LongAdder();
  private final LongAdder invalidGeometries = new LongAdder();
  private final LongAdder unsupportedColors = new LongAdder();
  private final LongAdder overlapKeysDropped = new LongAdder();
  private final LongAdder overlapCapWays = new LongAdder();

  public void acceptedRelation(TrailRelationInfo relation) {
    acceptedRelations.increment();
    if (relation.kind() == TrailClassifier.Kind.HIKING) hikingRelations.increment();
    else cyclingRelations.increment();
    if (relation.superRoute()) superRelations.increment();
    if (relation.unsupportedColor()) unsupportedColors.increment();
  }

  public void memberWaySeen() {
    memberWaysSeen.increment();
  }

  public void emittedFeatures(long count) {
    emittedFeatures.add(count);
  }

  public void invalidGeometry() {
    invalidGeometries.increment();
  }

  public void overlapKeysDropped(long count) {
    overlapKeysDropped.add(count);
  }

  public void overlapCapWay() {
    overlapCapWays.increment();
  }

  public void write(
    Path reportPath,
    String osmSnapshot,
    String osmSourceUrl,
    String osmSourceChecksum,
    String builderVersion,
    Path archivePath,
    String archiveSha256,
    long wallTimeMs,
    int minZoom,
    int maxZoom
  ) throws IOException {
    Files.writeString(reportPath, toJson(
      osmSnapshot, osmSourceUrl, osmSourceChecksum, builderVersion,
      archivePath, archiveSha256, wallTimeMs, minZoom, maxZoom
    ), StandardCharsets.UTF_8);
  }

  private String toJson(
    String osmSnapshot,
    String osmSourceUrl,
    String osmSourceChecksum,
    String builderVersion,
    Path archivePath,
    String archiveSha256,
    long wallTimeMs,
    int minZoom,
    int maxZoom
  ) throws IOException {
    return """
      {
        "schemaVersion": 1,
        "attribution": "© OpenStreetMap contributors",
        "dataLicense": "ODbL-1.0",
        "osmSnapshot": "%s",
        "osmSourceUrl": "%s",
        "osmSourceChecksum": "%s",
        "builder": {"name": "planetiler", "version": "%s"},
        "archive": {
          "file": "%s",
          "sha256": "%s",
          "bytes": %d,
          "minzoom": %d,
          "maxzoom": %d
        },
        "counts": {
          "acceptedRelations": %d,
          "hikingRelations": %d,
          "cyclingRelations": %d,
          "superRelations": %d,
          "memberWaysSeen": %d,
          "emittedFeatures": %d,
          "invalidGeometries": %d,
          "unsupportedColors": %d,
          "overlapKeysDropped": %d,
          "overlapCapWays": %d
        },
        "metrics": {
          "wallTimeMs": %d,
          "peakResidentMemoryBytes": null,
          "scratchDiskHighWaterMarkBytes": null,
          "tileCount": null,
          "maxCompressedTileBytes": null,
          "p50CompressedTileBytes": null,
          "p95CompressedTileBytes": null,
          "p99CompressedTileBytes": null,
          "densestZ12Tiles": []
        }
      }
      """.formatted(
      json(osmSnapshot),
      json(osmSourceUrl),
      json(osmSourceChecksum),
      json(builderVersion),
      json(archivePath.getFileName().toString()),
      json(archiveSha256),
      Files.size(archivePath),
      minZoom,
      maxZoom,
      acceptedRelations.sum(),
      hikingRelations.sum(),
      cyclingRelations.sum(),
      superRelations.sum(),
      memberWaysSeen.sum(),
      emittedFeatures.sum(),
      invalidGeometries.sum(),
      unsupportedColors.sum(),
      overlapKeysDropped.sum(),
      overlapCapWays.sum(),
      wallTimeMs
    );
  }

  private static String json(String value) {
    if (value == null) return "";
    return value.replace("\\", "\\\\")
      .replace("\"", "\\\"")
      .replace("\n", "\\n")
      .replace("\r", "\\r")
      .replace("\t", "\\t");
  }
}
