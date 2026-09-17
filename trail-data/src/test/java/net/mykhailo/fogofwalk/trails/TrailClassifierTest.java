package net.mykhailo.fogofwalk.trails;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TrailClassifierTest {
  @Test
  void acceptsOnlySchemaOneRelationKinds() {
    assertEquals(TrailClassifier.Kind.HIKING, classify(1, "route", "hiking").orElseThrow().kind());
    assertEquals(TrailClassifier.Kind.HIKING, classify(2, "superroute", "foot").orElseThrow().kind());
    assertEquals(TrailClassifier.Kind.CYCLING, classify(3, "route", "bicycle").orElseThrow().kind());
    assertTrue(classify(4, "route", "walking").isEmpty());
    assertTrue(classify(5, "route", "mtb").isEmpty());
    assertTrue(classify(6, "collection", "hiking").isEmpty());
  }

  @Test
  void normalizesRankAndColorPrecedence() {
    Map<String, Object> tags = tags("type", "route", "route", "hiking", "network", "iwn");
    tags.put("osmc:symbol", " RED:white:red_bar ");
    tags.put("colour", "green");
    var result = TrailClassifier.classifyRelation(10, tags).orElseThrow();
    assertEquals(4, result.networkRank());
    assertEquals("#d9272e", result.color());
    assertFalse(result.unsupportedColor());

    tags.remove("osmc:symbol");
    assertEquals("#15803d", TrailClassifier.classifyRelation(10, tags).orElseThrow().color());
    tags.put("colour", "white");
    var unsupported = TrailClassifier.classifyRelation(10, tags).orElseThrow();
    assertEquals(TrailClassifier.HIKING_FALLBACK_COLOR, unsupported.color());
    assertTrue(unsupported.unsupportedColor());
  }

  @Test
  void usesFixedCyclingColorAndSeparateRankRange() {
    Map<String, Object> tags = tags("type", "route", "route", "bicycle", "network", "ncn");
    tags.put("colour", "red");
    var result = TrailClassifier.classifyRelation(11, tags).orElseThrow();
    assertEquals(3, result.networkRank());
    assertEquals(TrailClassifier.CYCLING_COLOR, result.color());
    assertEquals(23, TrailClassifier.selectVisualFeatures(List.of(
      new TrailClassifier.Membership(11, result.kind(), result.networkRank(), result.color(), false)
    )).features().getFirst().sort());
  }

  @Test
  void coversEverySupportedNetworkRank() {
    assertEquals(4, TrailClassifier.networkRank(TrailClassifier.Kind.HIKING, "iwn"));
    assertEquals(3, TrailClassifier.networkRank(TrailClassifier.Kind.HIKING, "nwn"));
    assertEquals(2, TrailClassifier.networkRank(TrailClassifier.Kind.HIKING, "rwn"));
    assertEquals(1, TrailClassifier.networkRank(TrailClassifier.Kind.HIKING, "lwn"));
    assertEquals(4, TrailClassifier.networkRank(TrailClassifier.Kind.CYCLING, "icn"));
    assertEquals(3, TrailClassifier.networkRank(TrailClassifier.Kind.CYCLING, "ncn"));
    assertEquals(2, TrailClassifier.networkRank(TrailClassifier.Kind.CYCLING, "rcn"));
    assertEquals(1, TrailClassifier.networkRank(TrailClassifier.Kind.CYCLING, "lcn"));
    assertEquals(0, TrailClassifier.networkRank(TrailClassifier.Kind.CYCLING, "unknown"));
  }

  @Test
  void deduplicatesSharedKeysAndCentersFourLanes() {
    List<TrailClassifier.Membership> memberships = new ArrayList<>();
    String[] colors = { "#d9272e", "#15803d", "#1769aa", "#eab308", "#ea580c" };
    for (int i = 0; i < colors.length; i++) {
      memberships.add(new TrailClassifier.Membership(
        100 + i, TrailClassifier.Kind.HIKING, i == 0 ? 4 : 1, colors[i], false
      ));
    }
    memberships.add(new TrailClassifier.Membership(
      999, TrailClassifier.Kind.HIKING, 4, colors[0], true
    ));
    memberships.add(new TrailClassifier.Membership(
      300, TrailClassifier.Kind.CYCLING, 2, TrailClassifier.CYCLING_COLOR, false
    ));
    memberships.add(new TrailClassifier.Membership(
      301, TrailClassifier.Kind.CYCLING, 4, TrailClassifier.CYCLING_COLOR, true
    ));

    var selected = TrailClassifier.selectVisualFeatures(memberships);
    assertEquals(4, selected.features().size() - 1);
    assertEquals(1, selected.droppedKeys());
    assertEquals(List.of(-4.5, -1.5, 1.5, 4.5), selected.features().stream()
      .limit(4).map(TrailClassifier.VisualFeature::offset).toList());
    assertEquals(301, selected.features().getLast().relationId());
    assertEquals(24, selected.features().getLast().sort());
  }

  @Test
  void usesPaletteOrderWhenRanksAreEqual() {
    var selected = TrailClassifier.selectVisualFeatures(List.of(
      new TrailClassifier.Membership(
        300, TrailClassifier.Kind.HIKING, 2, "#eab308", false
      ),
      new TrailClassifier.Membership(
        100, TrailClassifier.Kind.HIKING, 2, "#d9272e", false
      ),
      new TrailClassifier.Membership(
        200, TrailClassifier.Kind.HIKING, 2, "#15803d", false
      )
    ));

    assertEquals(
      List.of("#d9272e", "#15803d", "#eab308"),
      selected.features().stream()
        .map(TrailClassifier.VisualFeature::color)
        .toList()
    );
  }

  private static java.util.Optional<TrailClassifier.RelationClassification> classify(
    long id, String type, String route
  ) {
    return TrailClassifier.classifyRelation(id, tags("type", type, "route", route));
  }

  private static Map<String, Object> tags(String... values) {
    Map<String, Object> result = new HashMap<>();
    for (int i = 0; i < values.length; i += 2) result.put(values[i], values[i + 1]);
    return result;
  }
}
