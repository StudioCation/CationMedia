; Register application capabilities without writing the protected UserChoice key.
!define VIEWER_CAPABILITIES "Software\StudioCation\CationViewer3D\Capabilities"
!define VIEWER_PROGID "StudioCation.CationViewer3D.Model"
!define AUDIO_PROGID "StudioCation.CationMedia.Audio"
!define IMAGE_PROGID "StudioCation.CationMedia.Image"
; A new icon path on upgrade avoids the shell's cached EXE resource icon.
!define SHELL_ICON "$INSTDIR\resources\cationmedia-${VERSION}.ico"

; Remove only our legacy BLEND registration. Keep other applications and UserChoice.
!macro RestoreBlendAssociation ROOT
  Push $0
  Push $1
  Push $2
  Push $3
  DeleteRegValue ${ROOT} "${VIEWER_CAPABILITIES}\FileAssociations" ".blend"
  DeleteRegValue ${ROOT} "Software\Classes\.blend\OpenWithProgids" "3D Model"
  DeleteRegValue ${ROOT} "Software\Classes\.blend\OpenWithProgids" "${VIEWER_PROGID}"
  ReadRegStr $0 ${ROOT} "Software\Classes\.blend" ""
  ${If} $0 == "3D Model"
  ${OrIf} $0 == "${VIEWER_PROGID}"
    StrCpy $1 0
    StrCpy $3 ""
    ${Do}
      ClearErrors
      EnumRegValue $0 HKCR ".blend\OpenWithProgids" $1
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      IntOp $1 $1 + 1
      StrCpy $2 $0 8
      ${If} $2 == "blender."
      ${OrIf} $0 == "blendfile"
        ReadRegStr $2 HKCR "$0\shell\open\command" ""
        ${If} $2 != ""
          StrCpy $3 $0
        ${EndIf}
      ${EndIf}
    ${Loop}
    ${If} $3 != ""
      WriteRegStr ${ROOT} "Software\Classes\.blend" "" "$3"
    ${Else}
      DeleteRegValue ${ROOT} "Software\Classes\.blend" ""
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro AudioExtension EXT
  WriteRegStr SHELL_CONTEXT "${VIEWER_CAPABILITIES}\FileAssociations" ".${EXT}" "${AUDIO_PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${AUDIO_PROGID}"
!macroend
!macro RemoveAudioExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${AUDIO_PROGID}"
!macroend
!macro AudioExtensions ACTION
  !insertmacro ${ACTION} "wav"
  !insertmacro ${ACTION} "mp3"
  !insertmacro ${ACTION} "flac"
  !insertmacro ${ACTION} "ogg"
  !insertmacro ${ACTION} "oga"
  !insertmacro ${ACTION} "opus"
  !insertmacro ${ACTION} "m4a"
  !insertmacro ${ACTION} "aac"
  !insertmacro ${ACTION} "aif"
  !insertmacro ${ACTION} "aiff"
  !insertmacro ${ACTION} "wma"
  !insertmacro ${ACTION} "ac3"
  !insertmacro ${ACTION} "aiffc"
  !insertmacro ${ACTION} "aifc"
  !insertmacro ${ACTION} "caf"
  !insertmacro ${ACTION} "amr"
  !insertmacro ${ACTION} "ape"
  !insertmacro ${ACTION} "mka"
  !insertmacro ${ACTION} "weba"
!macroend

!macro ImageExtension EXT
  WriteRegStr SHELL_CONTEXT "${VIEWER_CAPABILITIES}\FileAssociations" ".${EXT}" "${IMAGE_PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${IMAGE_PROGID}"
!macroend

!macro RemoveImageExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${IMAGE_PROGID}"
!macroend

!macro ImageExtensions ACTION
  !insertmacro ${ACTION} "jpg"
  !insertmacro ${ACTION} "jpeg"
  !insertmacro ${ACTION} "tif"
  !insertmacro ${ACTION} "tiff"
  !insertmacro ${ACTION} "png"
  !insertmacro ${ACTION} "gif"
  !insertmacro ${ACTION} "webp"
  !insertmacro ${ACTION} "bmp"
!macroend

!macro ViewerExtension EXT
  WriteRegStr SHELL_CONTEXT "${VIEWER_CAPABILITIES}\FileAssociations" ".${EXT}" "${VIEWER_PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${VIEWER_PROGID}"
!macroend

!macro RemoveViewerExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${VIEWER_PROGID}"
!macroend

!macro customInstall
  File "/oname=${SHELL_ICON}" "${BUILD_RESOURCES_DIR}\icon.ico"
  !insertmacro RestoreBlendAssociation SHELL_CONTEXT
  ; Earlier per-user installs can shadow a later all-users installation.
  !insertmacro RestoreBlendAssociation HKCU
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Cation Viewer 3D"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "CationMedia" "${VIEWER_CAPABILITIES}"
  WriteRegStr SHELL_CONTEXT "${VIEWER_CAPABILITIES}" "ApplicationName" "CationMedia"
  WriteRegStr SHELL_CONTEXT "${VIEWER_CAPABILITIES}" "ApplicationDescription" "View and edit 3D models, images, audio, and video"
  WriteRegStr SHELL_CONTEXT "${VIEWER_CAPABILITIES}" "ApplicationIcon" '$\"${SHELL_ICON}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\3D Model\DefaultIcon" "" '$\"${SHELL_ICON}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Audio\DefaultIcon" "" '$\"${SHELL_ICON}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${VIEWER_PROGID}" "" "3D Model"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${VIEWER_PROGID}\DefaultIcon" "" '$\"${SHELL_ICON}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${VIEWER_PROGID}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  !insertmacro ViewerExtension "glb"
  !insertmacro ViewerExtension "gltf"
  !insertmacro ViewerExtension "fbx"
  !insertmacro ViewerExtension "obj"
  !insertmacro ViewerExtension "stl"
  !insertmacro ViewerExtension "ply"
  !insertmacro ViewerExtension "dae"
  !insertmacro ViewerExtension "3ds"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${AUDIO_PROGID}" "" "CationMedia Audio"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${AUDIO_PROGID}\DefaultIcon" "" '$\"${SHELL_ICON}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${AUDIO_PROGID}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  !insertmacro AudioExtensions AudioExtension
  WriteRegStr SHELL_CONTEXT "Software\Classes\${IMAGE_PROGID}" "" "CationMedia Image"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${IMAGE_PROGID}\DefaultIcon" "" '$\"${SHELL_ICON}$\",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\${IMAGE_PROGID}\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
  !insertmacro ImageExtensions ImageExtension
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro RestoreBlendAssociation SHELL_CONTEXT
  !insertmacro RestoreBlendAssociation HKCU
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "CationMedia"
  DeleteRegKey SHELL_CONTEXT "Software\StudioCation\CationViewer3D"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${VIEWER_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${AUDIO_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${IMAGE_PROGID}"
  !insertmacro AudioExtensions RemoveAudioExtension
  !insertmacro ImageExtensions RemoveImageExtension
  !insertmacro RemoveViewerExtension "glb"
  !insertmacro RemoveViewerExtension "gltf"
  !insertmacro RemoveViewerExtension "fbx"
  !insertmacro RemoveViewerExtension "obj"
  !insertmacro RemoveViewerExtension "stl"
  !insertmacro RemoveViewerExtension "ply"
  !insertmacro RemoveViewerExtension "dae"
  !insertmacro RemoveViewerExtension "3ds"
  !insertmacro RemoveViewerExtension "blend"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
