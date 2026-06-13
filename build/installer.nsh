!macro customInit
  ; Intentar encontrar node.exe en el sistema
  nsExec::ExecToStack 'node -v'
  Pop $0 ; El código de salida de la operación
  
  ${If} $0 != 0
    ; Si el código de salida no es 0, Node.js no está en el PATH
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "Node.js LTS no parece estar instalado en este equipo. El editor funciona mejor conNode.js instalado para extensiones futuras. ¿Desea ir a la página de descarga oficial ahora?" IDNO +2
    ExecShell "open" "https://nodejs.org/"
  ${EndIf}
!macroend
