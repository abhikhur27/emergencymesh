// Reproduce the checked-in project without XcodeGen, CocoaPods or a package install.
// Run `node scripts/create-project.mjs` from ios/. The generated project has no absolute paths.
import {writeFileSync, mkdirSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const id = n => Number(n).toString(16).toUpperCase().padStart(24, '0');
const sources = readdirSync(`${root}/EmergencyMesh`).filter(name=>name.endsWith('.swift')).sort();
const tests = readdirSync(`${root}/EmergencyMeshTests`).filter(name=>name.endsWith('.swift')).sort();
if(!sources.includes('ContentView.swift')||!sources.includes('TemocView.swift')||!tests.includes('WireCodecTests.swift'))throw new Error('Required reviewed application/test source is missing');
const objects=[];
const add=(n,body)=>objects.push(`${id(n)} = { ${body} };`);
sources.forEach((name,i)=>{
  add(1000+i,`isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}; sourceTree = "<group>";`);
  add(2000+i,`isa = PBXBuildFile; fileRef = ${id(1000+i)};`);
});
add(110,'isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>";');
tests.forEach((name,i)=>{add(3000+i,`isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${name}; sourceTree = "<group>";`);add(4000+i,`isa = PBXBuildFile; fileRef = ${id(3000+i)};`);});
add(112,'isa = PBXFileReference; lastKnownFileType = text.json; path = "golden-v1.json"; sourceTree = "<group>";');
add(212,`isa = PBXBuildFile; fileRef = ${id(112)};`);
add(130,'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = RescueMesh.xcassets; sourceTree = "<group>";');
add(131,'isa = PBXFileReference; lastKnownFileType = folder; path = TemocModel; sourceTree = "<group>";');
add(230,`isa = PBXBuildFile; fileRef = ${id(130)};`);add(231,`isa = PBXBuildFile; fileRef = ${id(131)};`);
add(810,'isa = XCLocalSwiftPackageReference; relativePath = TemocRuntime;');
add(811,`isa = XCSwiftPackageProductDependency; package = ${id(810)}; productName = TemocRuntime;`);
add(812,`isa = PBXBuildFile; productRef = ${id(811)};`);
add(120,'isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = EmergencyMesh.app; sourceTree = BUILT_PRODUCTS_DIR;');
add(121,'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = EmergencyMeshTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;');
add(300,`isa = PBXGroup; children = (${id(301)},${id(302)},${id(303)},); sourceTree = "<group>";`);
add(301,`isa = PBXGroup; children = (${sources.map((_,i)=>id(1000+i)).join(',')},${id(110)},${id(130)},${id(131)},); path = EmergencyMesh; sourceTree = "<group>";`);
add(302,`isa = PBXGroup; children = (${tests.map((_,i)=>id(3000+i)).join(',')},${id(112)},); path = EmergencyMeshTests; sourceTree = "<group>";`);
add(303,`isa = PBXGroup; children = (${id(120)},${id(121)},); name = Products; sourceTree = "<group>";`);
add(400,`isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${sources.map((_,i)=>id(2000+i)).join(',')},); runOnlyForDeploymentPostprocessing = 0;`);
add(401,`isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (${id(812)},); runOnlyForDeploymentPostprocessing = 0;`);
add(402,`isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (${id(230)},${id(231)},); runOnlyForDeploymentPostprocessing = 0;`);
add(403,`isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (${tests.map((_,i)=>id(4000+i)).join(',')},); runOnlyForDeploymentPostprocessing = 0;`);
add(404,'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;');
add(405,`isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (${id(212)},); runOnlyForDeploymentPostprocessing = 0;`);
add(500,`isa = PBXNativeTarget; buildConfigurationList = ${id(601)}; buildPhases = (${id(400)},${id(401)},${id(402)},); buildRules = (); dependencies = (); packageProductDependencies = (${id(811)},); name = EmergencyMesh; productName = EmergencyMesh; productReference = ${id(120)}; productType = "com.apple.product-type.application";`);
add(501,`isa = PBXNativeTarget; buildConfigurationList = ${id(602)}; buildPhases = (${id(403)},${id(404)},${id(405)},); buildRules = (); dependencies = (${id(511)},); name = EmergencyMeshTests; productName = EmergencyMeshTests; productReference = ${id(121)}; productType = "com.apple.product-type.bundle.unit-test";`);
add(510,`isa = PBXContainerItemProxy; containerPortal = ${id(1)}; proxyType = 1; remoteGlobalIDString = ${id(500)}; remoteInfo = EmergencyMesh;`);
add(511,`isa = PBXTargetDependency; target = ${id(500)}; targetProxy = ${id(510)};`);
for (let i=0;i<3;i++) add(600+i,`isa = XCConfigurationList; buildConfigurations = (${id(700+i*2)},${id(701+i*2)},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`);
const common = 'CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = 1;';
for (let kind=0;kind<3;kind++) for (let release=0;release<2;release++) {
  let settings=common+` ONLY_ACTIVE_ARCH = ${release?'NO':'YES'};`;
  if (kind===0) settings+=` DEBUG_INFORMATION_FORMAT = ${release?'"dwarf-with-dsym"':'dwarf'}; SWIFT_OPTIMIZATION_LEVEL = ${release?'"-O"':'"-Onone"'}; ENABLE_TESTABILITY = ${release?'NO':'YES'}; SWIFT_ACTIVE_COMPILATION_CONDITIONS = ${release?'"$(inherited)"':'"DEBUG $(inherited)"'};`;
  if (kind===1) settings+=' PRODUCT_BUNDLE_IDENTIFIER = org.hackutd.EmergencyMesh; PRODUCT_NAME = "$(TARGET_NAME)"; INFOPLIST_FILE = EmergencyMesh/Info.plist; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = ""; CURRENT_PROJECT_VERSION = 2; MARKETING_VERSION = 0.2.0; GENERATE_INFOPLIST_FILE = NO; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = BrandPink; OTHER_LDFLAGS = "$(inherited) -lc++"; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks";';
  if (kind===2) settings+=' PRODUCT_BUNDLE_IDENTIFIER = org.hackutd.EmergencyMeshTests; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; CODE_SIGN_STYLE = Automatic; DEVELOPMENT_TEAM = ""; TEST_HOST = "$(BUILT_PRODUCTS_DIR)/EmergencyMesh.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/EmergencyMesh"; BUNDLE_LOADER = "$(TEST_HOST)"; LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @loader_path/Frameworks";';
  add(700+kind*2+release,`isa = XCBuildConfiguration; buildSettings = { ${settings} }; name = ${release?'Release':'Debug'};`);
}
add(1,`isa = PBXProject; attributes = { BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1600; TargetAttributes = { ${id(500)} = { CreatedOnToolsVersion = 16.0; }; ${id(501)} = { CreatedOnToolsVersion = 16.0; TestTargetID = ${id(500)}; }; }; }; buildConfigurationList = ${id(600)}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base,); mainGroup = ${id(300)}; productRefGroup = ${id(303)}; packageReferences = (${id(810)},); projectDirPath = ""; projectRoot = ""; targets = (${id(500)},${id(501)},);`);
mkdirSync(`${root}/EmergencyMesh.xcodeproj`,{recursive:true});
writeFileSync(`${root}/EmergencyMesh.xcodeproj/project.pbxproj`,`// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n${objects.join('\n')}\n}; rootObject = ${id(1)}; }\n`);
console.log(`Generated portable RescueMesh project: ${sources.length} app and ${tests.length} test source files, native branding and TemocRuntime.`);
