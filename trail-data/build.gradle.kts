import java.util.Properties

plugins {
  java
  application
}

val pinnedVersions = Properties().also {
  file("versions.properties").inputStream().use(it::load)
}

repositories {
  mavenCentral()
}

java {
  toolchain {
    languageVersion = JavaLanguageVersion.of(21)
  }
}

dependencies {
  implementation("com.onthegomap.planetiler:planetiler-core:${pinnedVersions["planetiler"]}")
  testImplementation(platform("org.junit:junit-bom:${pinnedVersions["junit"]}"))
  testImplementation("org.junit.jupiter:junit-jupiter")
}

application {
  mainClass = "net.mykhailo.fogofwalk.trails.TrailProfile"
}

tasks.test {
  useJUnitPlatform()
}

tasks.withType<JavaCompile>().configureEach {
  options.encoding = "UTF-8"
  options.release = 21
}
