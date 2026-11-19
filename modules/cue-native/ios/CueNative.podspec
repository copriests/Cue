Pod::Spec.new do |s|
  s.name = 'CueNative'
  s.version = '0.1.0'
  s.summary = 'Native speech tracking and sample-buffer teleprompter PiP'
  s.description = 'Local Expo module for Cue.'
  s.author = 'Cue'
  s.homepage = 'https://example.com/cue'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVKit', 'AVFoundation', 'Speech', 'CoreMedia', 'CoreVideo'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
